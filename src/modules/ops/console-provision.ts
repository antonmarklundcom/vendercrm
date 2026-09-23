import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { opsTokens, sites } from "@/db/schema";
import type { SuperadminContext } from "@/modules/tenancy/context";
import { addOpsRows, createOpsBatch, requireOwnRow } from "./batches";
import {
  provisionKey,
  provisionPipeline,
  provisionSite,
  provisionTenant,
  provisionTestLead,
} from "./provision";
import { OpsAccessError } from "./guard";
import { createOpsToken, type OpsTokenRow } from "./tokens";
import type { DomainEntry } from "./domain-list";

// Provisioning from the console (PLAN.md §18.3), without a terminal: the
// owner pastes a list of domains on /claude-ops and the page runs the same
// five steps scripts/provision-sites.mjs runs over HTTP.
//
// The steps are written against an ops token — every row belongs to one, and
// the guard answers "may this token touch X" from what the token created. So
// the console gets a token of its own rather than a second code path that
// skips the guard: one per superadmin, labelled CONSOLE_TOKEN_LABEL, minted
// on first use with its plaintext thrown away (nothing ever presents it; the
// console calls the step functions directly). It shows up in the token list
// like any other, and revoking it just means the next run mints a new one.
//
// Sites are still born inactive and still wait for the owner's approval on
// the same page (§18.1.4); the console changes who types the list, not who
// decides go-live.

export const CONSOLE_TOKEN_LABEL = "consola";

/** The superadmin's console token, minted on first use. */
async function consoleToken(ctx: SuperadminContext): Promise<OpsTokenRow> {
  const find = async () => {
    const [row] = await db
      .select()
      .from(opsTokens)
      .where(
        and(
          eq(opsTokens.ownerUserId, ctx.userId),
          eq(opsTokens.label, CONSOLE_TOKEN_LABEL),
          isNull(opsTokens.revokedAt),
        ),
      );
    return row && (!row.expiresAt || row.expiresAt > new Date()) ? row : null;
  };
  const existing = await find();
  if (existing) return existing;
  await createOpsToken(ctx, { label: CONSOLE_TOKEN_LABEL });
  const created = await find();
  if (!created) throw new Error("could not create the console ops token");
  return created;
}

export type ConsoleBatch = {
  batchId: string;
  rows: Array<{ id: string; domain: string; name: string }>;
  /** Domains that already have a site on the server, left out of the batch:
   * a second business for the same domain is never what re-running means. */
  existing: string[];
};

/** Creates the batch and its rows. The steps run per row, one request each. */
export async function startConsoleBatch(
  ctx: SuperadminContext,
  entries: DomainEntry[],
): Promise<ConsoleBatch> {
  const taken = entries.length
    ? await db
        .select({ domain: sites.domain })
        .from(sites)
        .where(
          inArray(
            sites.domain,
            entries.map((e) => e.domain),
          ),
        )
    : [];
  const takenSet = new Set(taken.map((t) => (t.domain ?? "").toLowerCase()));
  const fresh = entries.filter((e) => !takenSet.has(e.domain));

  const token = await consoleToken(ctx);
  const batch = await createOpsBatch(token, {
    title: `Consola ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    rawText: fresh.map((e) => `${e.domain}, ${e.name}`).join("\n"),
  });
  const rows = fresh.length
    ? await addOpsRows(
        token,
        batch.id,
        fresh.map((e) => ({ domain: e.domain, display_name: e.name, tenant_mode: "new" as const })),
      )
    : [];

  return {
    batchId: batch.id,
    rows: rows.map((row) => ({ id: row.id, domain: row.domain, name: row.displayName })),
    existing: [...takenSet].filter(Boolean).sort(),
  };
}

export type ConsoleRowResult =
  | { ok: true; tenantId: string; siteId: string; apiKey: string | null }
  | { ok: false; step: string; reason: string };

/**
 * Runs all five steps for one row. Each step is idempotent per row, so a
 * retry after a failure picks up where the last attempt stopped.
 */
export async function provisionConsoleRow(
  ctx: SuperadminContext,
  rowId: string,
): Promise<ConsoleRowResult> {
  const token = await consoleToken(ctx);
  let current = "tenant";
  try {
    // A row id from the browser is only ever one of this console token's own.
    await requireOwnRow(token, rowId);
    const tenant = await provisionTenant(token, rowId);
    current = "site";
    const site = await provisionSite(token, rowId);
    current = "pipeline";
    await provisionPipeline(token, rowId);
    current = "key";
    const key = await provisionKey(token, rowId, CONSOLE_TOKEN_LABEL);
    current = "test_lead";
    await provisionTestLead(token, rowId);
    return { ok: true, tenantId: tenant.tenantId, siteId: site.siteId, apiKey: key.plaintext };
  } catch (err) {
    const reason =
      err instanceof OpsAccessError || err instanceof Error ? err.message : String(err);
    return { ok: false, step: current, reason };
  }
}
