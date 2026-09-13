import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { siteIngestHealth } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import type { IngestLane, SiteRow } from "./ingest";

// Per-site ingest health (PLAN.md §5.2). Today a broken client site fails on
// THEIR server: the CRM just stops receiving, and "a quiet week" looks
// exactly like "the form has been 422ing since Tuesday". The owner finds out
// days later from a customer. This module is the fix — the write side runs on
// every ingest attempt, the read side feeds the status column on /sites.
//
// Two rules this file exists to keep:
//   1. **No payloads, no credentials.** A reason is a short stable code
//      ("phone-missing", "turnstile-failed"), never submitted data, never a
//      token or key, never an API response body.
//   2. **Never cost a lead.** Every write here is best-effort and swallowed
//      on failure; health bookkeeping must not be able to fail an ingest.

/** Short, stable, credential-free reason codes. The UI resolves them to
 * Spanish through next-intl (§1.2) — the code itself is never shown raw. */
export type IngestErrorReason =
  | "invalid-key"
  | "revoked-key"
  | "site-inactive"
  | "tenant-unavailable"
  | "tenant-read-only"
  | "rate-limited"
  | "turnstile-failed"
  | "invalid-body"
  | "phone-missing"
  | "unknown";

const REASONS = [
  "invalid-key",
  "revoked-key",
  "site-inactive",
  "tenant-unavailable",
  "tenant-read-only",
  "rate-limited",
  "turnstile-failed",
  "invalid-body",
  "phone-missing",
  "unknown",
] as const satisfies readonly IngestErrorReason[];

/**
 * The reason code the UI is allowed to look a translation up by.
 *
 * `last_error_reason` is a `varchar(200)`, not an enum: a row written by an
 * older build, a hand-edited fix or a future code this build doesn't know
 * yet all land in it. next-intl answers a missing key with the key path
 * itself, so without this the status column reads
 * "error 422 (app.sites.health.reasons.payload-too-large)" to the operator.
 * Anything unrecognised degrades to `unknown`, which every locale defines.
 */
export function ingestReasonKey(reason: string | null | undefined): IngestErrorReason {
  return (REASONS as readonly string[]).includes(reason ?? "")
    ? (reason as IngestErrorReason)
    : "unknown";
}

/**
 * Maps an ingest failure onto a reason code. Deliberately lossy: the
 * underlying message can carry zod field paths and Cloudflare error strings,
 * and none of that belongs in a column the UI renders.
 */
export function classifyIngestError(status: number, error: string): IngestErrorReason {
  if (status === 429) return "rate-limited";
  if (status === 401) return "invalid-key";
  if (status === 422) return error.includes("phone") ? "phone-missing" : "invalid-body";
  if (status === 403) {
    if (error.includes("Turnstile")) return "turnstile-failed";
    if (error.includes("inactive")) return "site-inactive";
    if (error.includes("read-only")) return "tenant-read-only";
    return "tenant-unavailable";
  }
  return "unknown";
}

/**
 * Upserts the site's health row. Uses raw `db` for the same reason key
 * resolution does (§3.3's documented exemption for this module): it runs on
 * the ingest path, where the tenant is known from the *site row* and never
 * from client input, and one INSERT … ON DUPLICATE KEY UPDATE is the whole
 * write. Reads go through tenantDb like everything else.
 */
async function upsertHealth(
  site: SiteRow,
  values: Partial<typeof siteIngestHealth.$inferInsert>,
  counter: "success" | "error",
): Promise<void> {
  try {
    await db
      .insert(siteIngestHealth)
      .values({
        id: newId(),
        tenantId: site.tenantId,
        siteId: site.id,
        successCount: counter === "success" ? 1 : 0,
        errorCount: counter === "error" ? 1 : 0,
        ...values,
      })
      .onDuplicateKeyUpdate({
        set: {
          ...values,
          updatedAt: new Date(),
          [counter === "success" ? "successCount" : "errorCount"]:
            counter === "success"
              ? sql`${siteIngestHealth.successCount} + 1`
              : sql`${siteIngestHealth.errorCount} + 1`,
        },
      });
  } catch {
    // Rule 2: bookkeeping never fails an ingest.
  }
}

export function recordIngestSuccess(site: SiteRow, lane: IngestLane): Promise<void> {
  return upsertHealth(
    site,
    { lastOutcome: "ok", lastSuccessAt: new Date(), lastSuccessLane: lane },
    "success",
  );
}

export function recordIngestFailure(
  site: SiteRow,
  lane: IngestLane,
  status: number,
  reason: IngestErrorReason,
): Promise<void> {
  return upsertHealth(
    site,
    {
      lastOutcome: "error",
      lastErrorAt: new Date(),
      lastErrorStatus: status,
      lastErrorReason: reason,
      lastErrorLane: lane,
    },
    "error",
  );
}

export type SiteHealthRow = typeof siteIngestHealth.$inferSelect;

export function listSiteHealth(ctx: TenantContext): Promise<SiteHealthRow[]> {
  return tenantDb(ctx).select(siteIngestHealth);
}

export function getSiteHealth(ctx: TenantContext, siteId: string) {
  return tenantDb(ctx)
    .select(siteIngestHealth, eq(siteIngestHealth.siteId, siteId))
    .then((rows) => rows[0] ?? null);
}

export type SiteHealthStatus = "ok" | "failing" | "idle";

/**
 * The one judgement the status column makes: a site whose **last** attempt
 * failed is failing, whichever way it failed. Not "has any errors" — a spam
 * bot hitting a 422 once last month must not paint a working site red, and a
 * site that recovered on its own should go back to green without anyone
 * clearing anything.
 *
 * Read from `last_outcome` rather than by comparing the two timestamps: they
 * are second-precision `datetime`s, so a failure landing in the same second
 * as the preceding success compares equal and the site would read healthy
 * while broken. The stored outcome has no such ambiguity.
 */
export function siteHealthStatus(health: SiteHealthRow | null | undefined): SiteHealthStatus {
  if (!health?.lastOutcome) return "idle";
  return health.lastOutcome === "error" ? "failing" : "ok";
}
