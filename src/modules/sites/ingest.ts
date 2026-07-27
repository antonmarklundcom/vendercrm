import { z } from "zod";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { normalizePhone } from "@/modules/crm/contacts";
import { recordLeadSubmission, type RecordLeadResult } from "@/modules/leads/submissions";
import { rateLimit } from "@/lib/rate-limit";
import { resolveSiteByApiKey } from "./keys";

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
  // Anything else the site wants preserved on the timeline.
  fields: z.record(z.string(), z.unknown()).optional(),
});

export type LeadIngestBody = z.infer<typeof leadIngestSchema>;

export type IngestOutcome =
  | { ok: true; result: RecordLeadResult }
  | { ok: false; status: 401 | 403 | 422 | 429; error: string };

// Per-site limiter, shared implementation (lib/rate-limit).
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

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
  if (!site.isActive) return { ok: false, status: 403, error: "Site is inactive" };

  if (!rateLimit(`ingest:${site.id}`, RATE_LIMIT, RATE_WINDOW_MS).allowed) {
    return { ok: false, status: 429, error: "Rate limit exceeded" };
  }

  const parsed = leadIngestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, status: 422, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const body = parsed.data;

  const ctx = await buildSystemTenantContext(site.tenantId);
  if (!ctx) return { ok: false, status: 403, error: "Tenant unavailable" };

  try {
    const result = await recordLeadSubmission(ctx, {
      siteId: site.id,
      phone: normalizePhone(body.phone),
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
