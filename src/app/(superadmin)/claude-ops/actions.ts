"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildSystemTenantContext, requireSuperadminContext } from "@/modules/tenancy/context";
import { updateSite } from "@/modules/sites/sites";
import { listRowsAwaitingOwner, retireTestLead } from "@/modules/ops";
import { writeAuditLog } from "@/modules/tenancy/audit";
import {
  createOpsBatch,
  createOpsToken,
  getOpsRow,
  getOpsTokenRow,
  listOpsTokens,
  markRowLive,
  markRowRejected,
  revokeOpsToken,
  setBatchRawText,
  setOpsTokenAllowlist,
} from "@/modules/ops";
import type { OpsRow } from "@/modules/ops";

// Server actions behind the Claude Ops console (PLAN.md §18.4). Every one
// re-checks superadmin itself (defense in depth, §3.3) and writes an
// ordinary audit entry tagged `console:<userId>` — the same marker
// modules/ops/audit.ts uses for `ops_token:<prefix>`, so the page's log is
// one filter over one table (queries.ts's listOpsAuditEntries).

function consoleVia(userId: string): string {
  return `console:${userId}`;
}

// --- Tokens ------------------------------------------------------------

export type CreateTokenState = {
  error: string | null;
  token: { plaintext: string; prefix: string } | null;
};

const createTokenSchema = z.object({
  label: z.string().trim().min(1).max(100),
});

export async function createTokenAction(
  _prevState: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const ctx = await requireSuperadminContext();
  const parsed = createTokenSchema.safeParse({ label: formData.get("label") });
  if (!parsed.success) return { error: "invalid", token: null };

  const allowedTenantIds = formData.getAll("allowedTenantIds").map(String).filter(Boolean);

  const created = await createOpsToken(ctx, { label: parsed.data.label, allowedTenantIds });
  await writeAuditLog({
    actorUserId: ctx.userId,
    action: "ops_token.created",
    entity: "ops_token",
    entityId: created.id,
    payload: { via: consoleVia(ctx.userId), label: parsed.data.label },
  });

  revalidatePath("/claude-ops");
  return { error: null, token: { plaintext: created.plaintext, prefix: created.prefix } };
}

export async function revokeTokenAction(formData: FormData): Promise<void> {
  const ctx = await requireSuperadminContext();
  const tokenId = String(formData.get("tokenId") ?? "");
  if (!tokenId) return;

  await revokeOpsToken(tokenId);
  await writeAuditLog({
    actorUserId: ctx.userId,
    action: "ops_token.revoked",
    entity: "ops_token",
    entityId: tokenId,
    payload: { via: consoleVia(ctx.userId) },
  });

  revalidatePath("/claude-ops");
}

export async function setAllowlistAction(formData: FormData): Promise<void> {
  const ctx = await requireSuperadminContext();
  const tokenId = String(formData.get("tokenId") ?? "");
  if (!tokenId) return;
  const tenantIds = String(formData.get("tenantIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  await setOpsTokenAllowlist(tokenId, tenantIds);
  await writeAuditLog({
    actorUserId: ctx.userId,
    action: "ops_token.allowlist_set",
    entity: "ops_token",
    entityId: tokenId,
    payload: { via: consoleVia(ctx.userId), tenant_ids: tenantIds },
  });

  revalidatePath("/claude-ops");
}

// --- Batches -------------------------------------------------------------

/** Batches belong to a token (§18.2); the console picks the owner's newest
 * live one rather than asking, since in practice there is one token per PC
 * (§18.1.1). */
async function newestActiveToken() {
  const tokens = await listOpsTokens();
  const active = tokens
    .filter((token) => !token.revokedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return active ? getOpsTokenRow(active.id) : null;
}

export async function createBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireSuperadminContext();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const tokenRow = await newestActiveToken();
  if (!tokenRow) return; // the page's empty state keeps this form hidden until a token exists

  const batch = await createOpsBatch(tokenRow, { title });
  await writeAuditLog({
    actorUserId: ctx.userId,
    action: "ops_batch.created",
    entity: "ops_batch",
    entityId: batch.id,
    payload: { via: consoleVia(ctx.userId), title },
  });

  redirect(`/claude-ops?batch=${batch.id}`);
}

export async function saveBatchTextAction(formData: FormData): Promise<void> {
  const ctx = await requireSuperadminContext();
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) return;
  const rawText = String(formData.get("rawText") ?? "");

  await setBatchRawText(batchId, rawText);
  await writeAuditLog({
    actorUserId: ctx.userId,
    action: "ops_batch.text_saved",
    entity: "ops_batch",
    entityId: batchId,
    payload: { via: consoleVia(ctx.userId) },
  });

  revalidatePath("/claude-ops");
}

// --- Rows: the go-live gate (§18.1.4, §18.4) ------------------------------

/** A record deleted by an earlier, interrupted approval click reads as
 * "not found" — treated as already done rather than a failure, the same
 * idempotence the ops steps themselves lean on (§18.1.7). */
export async function approveRowAction(formData: FormData): Promise<void> {
  const ctx = await requireSuperadminContext();
  const rowId = String(formData.get("rowId") ?? "");
  const row = await getOpsRow(rowId);
  if (!row || !row.tenantId || !row.siteId || row.state === "live") {
    revalidatePath("/claude-ops");
    return;
  }

  await activateRow(row, ctx.userId);
  revalidatePath("/claude-ops");
}

/**
 * Puts one row's site live. Shared by the single-row button and the bulk
 * action below so the two can never drift — approving fifty must mean exactly
 * what approving one means, including the audit entry.
 */
async function activateRow(row: OpsRow, actorUserId: string): Promise<boolean> {
  if (!row.tenantId || !row.siteId || row.state === "live") return false;

  const tenantCtx = await buildSystemTenantContext(row.tenantId);
  if (!tenantCtx) return false;

  await updateSite(tenantCtx, row.siteId, { isActive: true });
  await retireTestLead(tenantCtx, {
    contactId: row.testContactId,
    dealId: row.testDealId,
  });

  await markRowLive(row.id);
  await writeAuditLog({
    tenantId: row.tenantId,
    actorUserId,
    action: "site.activated",
    entity: "site",
    entityId: row.siteId,
    payload: { via: consoleVia(actorUserId), batch_id: row.batchId, row_id: row.id },
  });
  return true;
}

/**
 * Approves every row currently awaiting the owner.
 *
 * One row at a time is the right default — §18.1.4 makes go-live a decision
 * rather than a formality, and the single-row button is where that decision
 * is taken. But a batch of fifty turns "a decision each" into "fifty clicks",
 * and the clicks stop being decisions well before the fiftieth. This is the
 * same decision taken once, deliberately, on rows the owner has already
 * reviewed on this page.
 *
 * Sequential rather than Promise.all: each row activates a site, deletes two
 * records and writes an audit entry, and the pool is small on purpose
 * (src/db/client.ts). Fanning out is how the same page broke before.
 */
export async function approveAllRowsAction(): Promise<void> {
  const ctx = await requireSuperadminContext();

  for (const row of await listRowsAwaitingOwner()) {
    await activateRow(row, ctx.userId);
  }

  revalidatePath("/claude-ops");
}

export async function rejectRowAction(formData: FormData): Promise<void> {
  const ctx = await requireSuperadminContext();
  const rowId = String(formData.get("rowId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!rowId || !note) return;

  await markRowRejected(rowId, note);
  await writeAuditLog({
    actorUserId: ctx.userId,
    action: "ops_row.rejected",
    entity: "ops_batch_row",
    entityId: rowId,
    payload: { via: consoleVia(ctx.userId), note },
  });

  revalidatePath("/claude-ops");
}
