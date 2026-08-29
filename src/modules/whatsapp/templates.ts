import { eq } from "drizzle-orm";
import { waTemplates } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getAccount, getDecryptedAccessToken, markAccountError } from "./accounts";
import { GRAPH_API_BASE } from "./graph";

// Template sync (PLAN.md §6.4): "fetch templates from Meta on connect +
// manual sync button + nightly job; automations and inbox pick from synced,
// APPROVED templates only."

type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: unknown[];
};

const KNOWN_STATUSES = ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"] as const;
type TemplateStatus = (typeof KNOWN_STATUSES)[number];

function normalizeStatus(status: string): TemplateStatus {
  const upper = status.toUpperCase();
  return (KNOWN_STATUSES as readonly string[]).includes(upper)
    ? (upper as TemplateStatus)
    : "DISABLED";
}

/**
 * Pulls the account's templates from Meta and reconciles the local table.
 * Templates that no longer exist upstream are deleted rather than left
 * behind — a stale APPROVED row would otherwise offer the inbox a template
 * whose send is guaranteed to fail.
 */
export async function syncTemplates(ctx: TenantContext, accountId: string) {
  const account = await getAccount(ctx, accountId);
  if (!account) throw new Error(`WhatsApp account ${accountId} not found`);

  const token = getDecryptedAccessToken(account);
  const res = await fetch(
    `${GRAPH_API_BASE}/${account.wabaId}/message_templates?limit=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    // A 401/403 here is the canonical "token died" signal — surface it on
    // the account so the superadmin health view (§6.5) can show it instead
    // of the failure being buried in a dead job row.
    if (res.status === 401 || res.status === 403) {
      await markAccountError(account.id);
    }
    throw new Error(`Template sync failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as { data?: MetaTemplate[] };
  const remote = body.data ?? [];

  const existing = await tenantDb(ctx).select(
    waTemplates,
    eq(waTemplates.waAccountId, account.id),
  );
  const keyOf = (t: { name: string; language: string }) => `${t.name}|${t.language}`;
  const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));

  for (const template of remote) {
    const match = existingByKey.get(keyOf(template));
    const values = {
      status: normalizeStatus(template.status),
      category: template.category,
      components: (template.components ?? []) as object,
    };

    if (match) {
      await tenantDb(ctx).update(waTemplates).set(values).where(eq(waTemplates.id, match.id));
      existingByKey.delete(keyOf(template));
    } else {
      await tenantDb(ctx)
        .insert(waTemplates)
        .values({
          id: newId(),
          waAccountId: account.id,
          name: template.name,
          language: template.language,
          ...values,
        });
    }
  }

  // Whatever is left in the map no longer exists at Meta.
  for (const stale of existingByKey.values()) {
    await tenantDb(ctx).delete(waTemplates, eq(waTemplates.id, stale.id));
  }

  return remote.length;
}

export async function listTemplates(ctx: TenantContext, accountId: string) {
  const rows = await tenantDb(ctx).select(waTemplates, eq(waTemplates.waAccountId, accountId));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Only APPROVED templates are sendable (§6.4) — the picker and, later, automations use this. */
export async function listApprovedTemplates(ctx: TenantContext, accountId: string) {
  const rows = await listTemplates(ctx, accountId);
  return rows.filter((row) => row.status === "APPROVED");
}

export type TemplateSubmission = {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  components: unknown[];
};

export type SubmitTemplateOutcome =
  | { status: "submitted"; name: string }
  | { status: "exists"; name: string }
  | { status: "failed"; name: string; error: string };

/**
 * Creates one template in the tenant's own WABA and returns what Meta said.
 *
 * Per-tenant by necessity: a template belongs to a WhatsApp Business
 * Account, so the platform cannot approve one centrally and lend it out —
 * every tenant submits its own copy and waits out its own review. Callers
 * are expected to treat "already exists" as success, because this is a
 * button an admin will press twice.
 */
export async function submitTemplate(
  ctx: TenantContext,
  accountId: string,
  submission: TemplateSubmission,
): Promise<SubmitTemplateOutcome> {
  const account = await getAccount(ctx, accountId);
  if (!account) throw new Error(`WhatsApp account ${accountId} not found`);

  const token = getDecryptedAccessToken(account);
  const res = await fetch(`${GRAPH_API_BASE}/${account.wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });

  if (res.ok) return { status: "submitted", name: submission.name };

  const body = await res.text();
  if (res.status === 401 || res.status === 403) await markAccountError(account.id);
  // Meta answers a re-submission with error 2388023 / "template name already
  // exists"; that is the steady state after the first press, not a fault.
  if (/already exist/i.test(body)) return { status: "exists", name: submission.name };
  return { status: "failed", name: submission.name, error: body.slice(0, 500) };
}
