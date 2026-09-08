import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { opsBatches, opsBatchRows } from "@/db/schema";
import { newId } from "@/lib/ids";
import { OpsAccessError } from "./guard";
import type { OpsTokenRow } from "./tokens";

// Batches and rows (PLAN.md §18.1.5). The batch is the unit of work and it is
// optional: a session provisioning one dentist creates a batch with a
// one-line title, while the owner pasting twelve domains on the page gets
// rows the session writes for him. The page is a control tower, never a gate
// on starting.

export type OpsBatchRow = typeof opsBatches.$inferSelect;
export type OpsRow = typeof opsBatchRows.$inferSelect;

export const OPS_STEPS = ["tenant", "site", "pipeline", "key", "test_lead"] as const;
export type OpsStep = (typeof OPS_STEPS)[number];

export type OpsStepStatus = "pending" | "done" | "failed" | "skipped";
export type OpsStepState = { status: OpsStepStatus; at?: string };
export type OpsSteps = Partial<Record<OpsStep, OpsStepState>>;

export type OpsRowState =
  | "pending"
  | "running"
  | "needs_input"
  | "failed"
  | "awaiting_approval"
  | "live";

export type OpsRowDetails = {
  stages?: string[];
  owner_email?: string;
  tags?: string[];
  wa_account_id?: string;
  notes?: string;
  /** Only read by the tenant step, and only for `tenant_mode: "new"`. */
  admin_email?: string;
  admin_name?: string;
  tenant_name?: string;
  tenant_slug?: string;
};

export type OpsLastError = { step: OpsStep; status: number; reason: string };

export function rowSteps(row: OpsRow): OpsSteps {
  return (row.steps ?? {}) as OpsSteps;
}

export function rowDetails(row: OpsRow): OpsRowDetails {
  return (row.details ?? {}) as OpsRowDetails;
}

// --- Batches ------------------------------------------------------------

export async function createOpsBatch(
  token: OpsTokenRow,
  input: { title: string; rawText?: string | null },
): Promise<OpsBatchRow> {
  const id = newId();
  await db.insert(opsBatches).values({
    id,
    tokenId: token.id,
    title: input.title,
    rawText: input.rawText ?? null,
  });
  const batch = await findOwnBatch(token, id);
  if (!batch) throw new OpsAccessError(404, "batch not found");
  return batch;
}

/** Own batches only — the token cannot see another token's work. */
export async function listOpsBatches(token: OpsTokenRow): Promise<OpsBatchRow[]> {
  return db
    .select()
    .from(opsBatches)
    .where(eq(opsBatches.tokenId, token.id))
    .orderBy(desc(opsBatches.createdAt));
}

export async function findOwnBatch(
  token: OpsTokenRow,
  batchId: string,
): Promise<OpsBatchRow | null> {
  const [row] = await db
    .select()
    .from(opsBatches)
    .where(and(eq(opsBatches.id, batchId), eq(opsBatches.tokenId, token.id)));
  return row ?? null;
}

export async function requireOwnBatch(
  token: OpsTokenRow,
  batchId: string,
): Promise<OpsBatchRow> {
  const batch = await findOwnBatch(token, batchId);
  // Another token's batch is "not found", not "forbidden" — same reasoning as
  // OpsAccessError's.
  if (!batch) throw new OpsAccessError(404, "batch not found");
  return batch;
}

export async function setBatchStatus(
  token: OpsTokenRow,
  batchId: string,
  status: "open" | "done" | "archived",
): Promise<OpsBatchRow> {
  await requireOwnBatch(token, batchId);
  await db.update(opsBatches).set({ status }).where(eq(opsBatches.id, batchId));
  return requireOwnBatch(token, batchId);
}

// --- Rows ---------------------------------------------------------------

export type CreateOpsRowInput = {
  domain: string;
  display_name: string;
  tenant_mode?: "new" | "existing";
  tenant_id?: string | null;
  details?: OpsRowDetails;
};

export async function addOpsRows(
  token: OpsTokenRow,
  batchId: string,
  inputs: CreateOpsRowInput[],
): Promise<OpsRow[]> {
  await requireOwnBatch(token, batchId);

  const created: string[] = [];
  for (const input of inputs) {
    const id = newId();
    await db.insert(opsBatchRows).values({
      id,
      batchId,
      domain: input.domain,
      displayName: input.display_name,
      tenantMode: input.tenant_mode ?? "new",
      tenantId: input.tenant_id ?? null,
      details: input.details ?? {},
      steps: {},
    });
    created.push(id);
  }

  const rows = await listOpsRows(token, batchId);
  return rows.filter((row) => created.includes(row.id));
}

export async function listOpsRows(token: OpsTokenRow, batchId: string): Promise<OpsRow[]> {
  await requireOwnBatch(token, batchId);
  return db
    .select()
    .from(opsBatchRows)
    .where(eq(opsBatchRows.batchId, batchId))
    .orderBy(opsBatchRows.createdAt);
}

/**
 * A row is reachable only through its batch, and the batch only through its
 * token — so one lookup answers "is this row mine". The join is done in two
 * queries rather than one so the refusal is the same OpsAccessError every
 * other path raises.
 */
export async function requireOwnRow(token: OpsTokenRow, rowId: string): Promise<OpsRow> {
  const [row] = await db.select().from(opsBatchRows).where(eq(opsBatchRows.id, rowId));
  if (!row) throw new OpsAccessError(404, "row not found");
  await requireOwnBatch(token, row.batchId);
  return row;
}

export type UpdateOpsRowInput = {
  display_name?: string;
  tenant_mode?: "new" | "existing";
  tenant_id?: string | null;
  details?: OpsRowDetails;
  needs_input?: string | null;
  state?: Extract<OpsRowState, "pending" | "needs_input">;
};

/**
 * The session's own edits to a row: what it learned from the owner, a note,
 * a corrected owner e-mail. Deliberately cannot set `live` or
 * `awaiting_approval` — those are the provisioning steps' and the owner's to
 * write, and a session must not be able to mark its own work approved.
 */
export async function updateOpsRow(
  token: OpsTokenRow,
  rowId: string,
  input: UpdateOpsRowInput,
): Promise<OpsRow> {
  const row = await requireOwnRow(token, rowId);

  // Once the tenant step has run, the row's business is settled: the site,
  // pipeline and key that follow are created inside it, and re-pointing the
  // row afterwards would mean a later step working in a different tenant
  // than the earlier ones did. (The steps re-check this too — see
  // `resolveOpsSite` — but a row that cannot lie is better than a row whose
  // lie is caught.)
  const settled = rowSteps(row).tenant?.status === "done";
  const movesTenant =
    (input.tenant_id !== undefined && input.tenant_id !== row.tenantId) ||
    (input.tenant_mode !== undefined && input.tenant_mode !== row.tenantMode);
  if (settled && movesTenant) {
    throw new OpsAccessError(
      422,
      "the tenant step has already run for this row; its business cannot be changed",
    );
  }

  const details = input.details
    ? ({ ...rowDetails(row), ...input.details } as OpsRowDetails)
    : undefined;

  await db
    .update(opsBatchRows)
    .set({
      ...(input.display_name !== undefined ? { displayName: input.display_name } : {}),
      ...(input.tenant_mode !== undefined ? { tenantMode: input.tenant_mode } : {}),
      ...(input.tenant_id !== undefined ? { tenantId: input.tenant_id } : {}),
      ...(details ? { details } : {}),
      ...(input.needs_input !== undefined ? { needsInput: input.needs_input } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
    })
    .where(eq(opsBatchRows.id, rowId));

  return requireOwnRow(token, rowId);
}

// --- Step bookkeeping ---------------------------------------------------

type RowPatch = Partial<typeof opsBatchRows.$inferInsert>;

async function patchRow(rowId: string, patch: RowPatch): Promise<void> {
  await db.update(opsBatchRows).set(patch).where(eq(opsBatchRows.id, rowId));
}

export async function markStepDone(
  row: OpsRow,
  step: OpsStep,
  patch: RowPatch = {},
  state: OpsRowState = "running",
): Promise<void> {
  const steps: OpsSteps = {
    ...rowSteps(row),
    [step]: { status: "done", at: new Date().toISOString() },
  };
  await patchRow(row.id, { ...patch, steps, state, lastError: null });
}

/**
 * A failure is stored on the row verbatim (§18.1.7) — the endpoint's own
 * status and reason, so the page shows what actually happened rather than a
 * summary written by whoever last touched this file.
 */
export async function markStepFailed(
  row: OpsRow,
  step: OpsStep,
  status: number,
  reason: string,
): Promise<void> {
  const steps: OpsSteps = {
    ...rowSteps(row),
    [step]: { status: "failed", at: new Date().toISOString() },
  };
  await patchRow(row.id, {
    steps,
    state: "failed",
    lastError: { step, status, reason } satisfies OpsLastError,
  });
}

// --- Superadmin console reads (the O2 page) -----------------------------
//
// These take no context argument, the same way `listTenants()` doesn't: they
// read platform-level tables, and their only callers are server actions that
// have already passed `requireSuperadminContext()`. Nothing here is reachable
// from a tenant session or from an ops token.

export async function listAllOpsBatches(): Promise<OpsBatchRow[]> {
  return db.select().from(opsBatches).orderBy(desc(opsBatches.createdAt));
}

export async function listRowsForBatch(batchId: string): Promise<OpsRow[]> {
  return db
    .select()
    .from(opsBatchRows)
    .where(eq(opsBatchRows.batchId, batchId))
    .orderBy(opsBatchRows.createdAt);
}

export async function getOpsRow(rowId: string): Promise<OpsRow | null> {
  const [row] = await db.select().from(opsBatchRows).where(eq(opsBatchRows.id, rowId));
  return row ?? null;
}

/** Every row still waiting on the owner — the page's "Needs you" list. */
export async function listRowsAwaitingOwner(): Promise<OpsRow[]> {
  const rows = await db
    .select()
    .from(opsBatchRows)
    .orderBy(desc(opsBatchRows.updatedAt));
  return rows.filter(
    (row) =>
      row.state === "awaiting_approval" ||
      row.state === "needs_input" ||
      row.state === "failed",
  );
}

/**
 * The go-live half of the owner's approval (§18.1.4). Activating the site and
 * deleting the test lead are the console's to do — this only records the
 * outcome on the row, so the two phases don't own the same write.
 */
export async function markRowLive(rowId: string): Promise<void> {
  await patchRow(rowId, {
    state: "live",
    needsInput: null,
    testContactId: null,
    testDealId: null,
  });
}

export async function markRowRejected(rowId: string, note: string): Promise<void> {
  await patchRow(rowId, { state: "needs_input", needsInput: note });
}
