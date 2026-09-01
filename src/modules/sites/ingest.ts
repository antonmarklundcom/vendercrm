import { z } from "zod";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { normalizePhone } from "@/modules/crm/contacts";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import { recordLeadSubmission, type RecordLeadResult } from "@/modules/leads/submissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import type { sites } from "@/db/schema";
import { resolveSiteByApiKey } from "./keys";
import { siteSettings, siteTurnstileSecret } from "./settings";
import { classifyIngestError, recordIngestFailure, recordIngestSuccess } from "./health";

// Public ingest (PLAN.md §5.1). Server-to-server only: the site's own
// backend posts with its key. This file owns authentication, validation and
// rate limiting; the CRM-side effects live in modules/leads.

export const leadIngestSchema = z.object({
  // Phone is contact identity (§5), so it's the one required field.
  phone: z.string().min(6).max(30),
  name: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  message: z.string().max(5000).optional(),
  source: z.string().max(100).optional(),
  utm_source: z.string().max(200).optional(),
  utm_medium: z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_term: z.string().max(200).optional(),
  utm_content: z.string().max(200).optional(),
  gclid: z.string().max(200).optional(),
  fbclid: z.string().max(200).optional(),
  page_url: z.string().max(2000).optional(),
  referrer: z.string().max(2000).optional(),
  idempotency_key: z.string().min(8).max(100),
  // Optional Turnstile token (§5.2). Available, not mandatory: a site whose
  // backend renders the widget can forward the token it received; one that
  // doesn't behaves exactly as before. Enforcement is per-site
  // (`turnstile.requireOnIngest`), never decided by the caller.
  turnstile_token: z.string().max(4000).optional(),
  // Anything else the site wants preserved on the timeline.
  fields: z.record(z.string(), z.unknown()).optional(),
});

export type LeadIngestBody = z.infer<typeof leadIngestSchema>;

export type IngestOutcome =
  | { ok: true; result: RecordLeadResult }
  | { ok: false; status: 401 | 403 | 422 | 429; error: string };

/**
 * Which lane a submission came in on (§5.2). The write is identical; the
 * limits are not. The webhook lane's credential travels in a URL path, so it
 * ends up in third-party request logs, browser history and support tickets
 * in a way a header key never does — a leaked webhook token deserves to hit
 * a wall sooner.
 */
export type IngestLane = "key" | "hook";

// Per-site fixed-window limiter (see lib/rate-limit for the shared
// implementation, now backed by MySQL rather than process memory).
const RATE_LIMITS: Record<IngestLane, { limit: number; windowMs: number }> = {
  key: { limit: 60, windowMs: 60_000 },
  hook: { limit: 20, windowMs: 60_000 },
};

async function rateLimited(lane: IngestLane, siteId: string): Promise<boolean> {
  const { limit, windowMs } = RATE_LIMITS[lane];
  // Separate bucket per lane: a noisy webhook must not spend the site's own
  // backend's budget.
  return (await checkRateLimit(`leads:${lane}:${siteId}`, limit, windowMs)).limited;
}

export type SiteRow = typeof sites.$inferSelect;

export type IngestRequestMeta = {
  ipAddress?: string;
  userAgent?: string;
};

export async function ingestLead(
  apiKey: string | null,
  rawBody: unknown,
  meta: IngestRequestMeta = {},
): Promise<IngestOutcome> {
  if (!apiKey) return { ok: false, status: 401, error: "Missing API key" };

  const site = await resolveSiteByApiKey(apiKey);
  if (!site) return { ok: false, status: 401, error: "Invalid API key" };

  return ingestLeadForSite(site, rawBody, meta, "key");
}

/**
 * The engine both lanes end in (§5.2). `ingestLead` above resolves an
 * `X-Api-Key` and calls this; the webhook receiver resolves its own token,
 * translates an arbitrary payload into this body shape, and calls this.
 * There is exactly one implementation of "an inbound lead becomes CRM data",
 * and per-site routing is read from the site record here — never from the
 * caller, on either lane.
 */
export async function ingestLeadForSite(
  site: SiteRow,
  rawBody: unknown,
  meta: IngestRequestMeta = {},
  lane: IngestLane = "key",
): Promise<IngestOutcome> {
  const outcome = await runIngest(site, rawBody, meta, lane);

  // Per-site health (§5.2). Recorded here, around the single engine, so both
  // lanes are covered by one call site and no failure path can forget. Never
  // awaited into the caller's error handling: bookkeeping must not fail an
  // ingest, and it stores no payload and no credential.
  if (outcome.ok) {
    await recordIngestSuccess(site, lane);
  } else {
    await recordIngestFailure(
      site,
      lane,
      outcome.status,
      classifyIngestError(outcome.status, outcome.error),
    );
  }

  return outcome;
}

async function runIngest(
  site: SiteRow,
  rawBody: unknown,
  meta: IngestRequestMeta,
  lane: IngestLane,
): Promise<IngestOutcome> {
  if (!site.isActive) return { ok: false, status: 403, error: "Site is inactive" };

  if (await rateLimited(lane, site.id)) {
    return { ok: false, status: 429, error: "Rate limit exceeded" };
  }

  const parsed = leadIngestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, status: 422, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const body = parsed.data;

  // Turnstile (§5.2), per-site and optional. Three states, in order:
  //   1. no secret configured  → skipped entirely (every site before 5.2);
  //   2. configured + a token in the body → verified, and a bad token is a
  //      403 rather than a silently accepted lead;
  //   3. configured + no token → accepted unless the site opted into
  //      requireOnIngest. The keyed lane already proves who is calling; the
  //      challenge is defense in depth on top of that, not the auth itself.
  const turnstileSecret = siteTurnstileSecret(site);
  if (turnstileSecret && (body.turnstile_token || siteSettings(site).turnstile?.requireOnIngest)) {
    const verdict = await verifyTurnstileToken({
      secret: turnstileSecret,
      token: body.turnstile_token,
      remoteIp: meta.ipAddress,
    });
    if (!verdict.ok) {
      return { ok: false, status: 403, error: `Turnstile verification failed: ${verdict.reason}` };
    }
  }

  const ctx = await buildSystemTenantContext(site.tenantId);
  if (!ctx) return { ok: false, status: 403, error: "Tenant unavailable" };

  const tenant = await getTenant(site.tenantId);
  const tenantSettings = (tenant?.settings ?? {}) as TenantSettings;

  try {
    const result = await recordLeadSubmission(ctx, {
      siteId: site.id,
      phone: normalizePhone(body.phone, tenantSettings.defaultCountry ?? DEFAULT_COUNTRY),
      name: body.name,
      email: body.email,
      message: body.message,
      source: body.source ?? `site:${site.slug}`,
      utm: {
        source: body.utm_source,
        medium: body.utm_medium,
        campaign: body.utm_campaign,
        term: body.utm_term,
        content: body.utm_content,
        gclid: body.gclid,
        fbclid: body.fbclid,
      },
      pageUrl: body.page_url,
      referrer: body.referrer,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      idempotencyKey: body.idempotency_key,
      payload: body.fields ?? {},
      // Routing defaults come from the site record, never the caller — a
      // leaked key can't move leads into another pipeline (§5.1).
      defaults: {
        pipelineId: site.defaultPipelineId,
        stageId: site.defaultStageId,
        ownerUserId: site.defaultOwnerUserId,
        tagIds: (site.defaultTagIds as string[]) ?? [],
        dealTitle: `${site.name} — ${body.name || body.phone}`,
      },
    });

    return { ok: true, result };
  } catch (err) {
    // A grace/locked tenant is rejected at the write path by tenantDb
    // (§10 1C follow-up #1) — surface that as 403 rather than a 500.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not writable")) {
      return { ok: false, status: 403, error: "Tenant is read-only" };
    }
    throw err;
  }
}
