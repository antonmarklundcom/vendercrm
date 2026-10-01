import { z } from "zod";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { normalizePhone } from "@/modules/crm/contacts";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import {
  recordLeadSubmission,
  type LeadUtm,
  type RecordLeadResult,
} from "@/modules/leads/submissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import type { sites } from "@/db/schema";
import { findSiteByRevokedApiKey, resolveSiteByApiKey } from "./keys";
import { siteSettings, siteTurnstileSecret } from "./settings";
import { classifyIngestError, recordIngestFailure, recordIngestSuccess } from "./health";

// Public ingest (PLAN.md §5.1). Server-to-server only: the site's own
// backend posts with its key. This file owns authentication, validation and
// rate limiting; the CRM-side effects live in modules/leads.

// Identity and dedupe stay strict (§19.3 item 5): `phone` and
// `idempotency_key` still 422. Every other text value is accepted at any
// length and repaired afterwards by `repairLeadBody` — a lost lead is worse
// than a truncated UTM. Unknown top-level keys pass through and are folded
// into `fields` there, instead of being stripped silently.
const optionalText = z.string().nullish();

export const leadIngestSchema = z
  .object({
    // Phone is contact identity (§5), so it's the one required field.
    phone: z.string().min(6).max(30),
    name: optionalText,
    email: optionalText,
    message: optionalText,
    source: optionalText,
    utm_source: optionalText,
    utm_medium: optionalText,
    utm_campaign: optionalText,
    utm_term: optionalText,
    utm_content: optionalText,
    gclid: optionalText,
    fbclid: optionalText,
    page_url: optionalText,
    referrer: optionalText,
    idempotency_key: z.string().min(8).max(100),
    // Optional Turnstile token (§5.2). Available, not mandatory: a site whose
    // backend renders the widget can forward the token it received; one that
    // doesn't behaves exactly as before. Enforcement is per-site
    // (`turnstile.requireOnIngest`), never decided by the caller.
    turnstile_token: z.string().max(4000).optional(),
    // Anything else the site wants preserved on the timeline.
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export type LeadIngestBody = z.infer<typeof leadIngestSchema>;

/** The ingest guard's limits (PLAN.md §19.3). */
export const INGEST_LIMITS = {
  /** Above this the request is refused outright; everything below is repaired. */
  bodyBytes: 256 * 1024,
  fieldKeys: 100,
  fieldKeyLength: 100,
  fieldValueLength: 5000,
  fieldsBytes: 64 * 1024,
  /** Untruncated originals, kept "where size allows" in `payload._original`. */
  originalValueLength: 20_000,
  originalBytes: 64 * 1024,
} as const;

const TRUNCATED_MARK = "…[truncado]";

// Column (and former zod) maximums of the top-level text values.
const UTM_KEYS = [
  ["utm_source", "source"],
  ["utm_medium", "medium"],
  ["utm_campaign", "campaign"],
  ["utm_term", "term"],
  ["utm_content", "content"],
  ["gclid", "gclid"],
  ["fbclid", "fbclid"],
] as const;
const UTM_MAX = 200;
const URL_MAX = 2000;
const EMAIL_MAX = 320;
const DEAL_TITLE_MAX = 200;

const KNOWN_KEYS = new Set(Object.keys(leadIngestSchema.shape));

// Credential-shaped names are never customer data (§19.3 item 1). Compared
// with case and separators stripped, so `api_key`, `X-Api-Key` and `apiKey`
// are one name.
const CREDENTIAL_NAMES = new Set([
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "auth",
  "authorization",
  "cfturnstileresponse",
]);
const CREDENTIAL_SUFFIXES = [
  "apikey",
  "secretkey",
  "privatekey",
  "accesskey",
  "token",
  "secret",
  "password",
  "passwd",
];

export function isCredentialKey(key: string): boolean {
  const name = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return CREDENTIAL_NAMES.has(name) || CREDENTIAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");

/** Cuts to `max` UTF-16 units without leaving half a surrogate pair behind. */
function cutText(value: string, max: number): string {
  let cut = value.slice(0, Math.max(0, max));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

function truncateWithMark(value: string, max: number): string {
  return `${cutText(value, max - TRUNCATED_MARK.length)}${TRUNCATED_MARK}`;
}

const asText = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));

type Repairs = {
  codes: Set<string>;
  original: Array<[string, string]>;
  originalBytes: number;
  originalCut: string[];
};

/**
 * The untruncated value goes to `payload._original[key]` (§19.3 item 3b),
 * capped per value and in total; past either cap it is cut and the key is
 * listed in `_original_cut`.
 */
function keepOriginal(repairs: Repairs, key: string, value: string) {
  if (repairs.original.some(([seen]) => seen === key)) return;
  let text = value;
  let cut = false;
  if (text.length > INGEST_LIMITS.originalValueLength) {
    text = cutText(text, INGEST_LIMITS.originalValueLength);
    cut = true;
  }
  // `"key":"value",` — the separators are what the 4 covers.
  const budget = INGEST_LIMITS.originalBytes - repairs.originalBytes - jsonBytes(key) - 4;
  if (budget <= 2) {
    text = "";
    cut = true;
  }
  while (text && jsonBytes(text) > budget) {
    text = cutText(text, Math.floor((text.length * budget) / jsonBytes(text)) - 1);
    cut = true;
  }
  if (text) {
    repairs.original.push([key, text]);
    repairs.originalBytes += jsonBytes(key) + jsonBytes(text) + 4;
  }
  if (cut) repairs.originalCut.push(key);
}

export type RepairedLead = {
  name: string | undefined;
  /** A usable e-mail, safe to put on the contact. */
  email: string | undefined;
  /** What the visitor typed when it was not a usable e-mail (as typed, clipped to the column). */
  invalidEmail: string | undefined;
  message: string | undefined;
  source: string | undefined;
  utm: LeadUtm;
  pageUrl: string | undefined;
  referrer: string | undefined;
  /** `fields` plus folded top-level extras, capped, with `_original` when anything was cut. */
  payload: Record<string, unknown>;
  /** Repair codes; null when the lead arrived clean. */
  needsReview: string[] | null;
};

/**
 * Accept-and-repair (PLAN.md §19.3): every value the site sent is either kept
 * as is, kept truncated with its original in `payload._original`, or — only
 * for credential-shaped names — never stored. Each repair leaves a code in
 * `needsReview` so the rep sees a "Revisar" badge instead of a missing lead.
 */
export function repairLeadBody(body: LeadIngestBody): RepairedLead {
  const repairs: Repairs = { codes: new Set(), original: [], originalBytes: 2, originalCut: [] };

  const clip = (key: string, value: string | null | undefined, max: number, code: string, mark: boolean) => {
    if (value === null || value === undefined) return undefined;
    if (value.length <= max) return value;
    keepOriginal(repairs, key, value);
    repairs.codes.add(code);
    return mark ? truncateWithMark(value, max) : cutText(value, max);
  };

  const name = clip("name", body.name, 200, "name_truncated", true);
  const message = clip("message", body.message, 5000, "message_truncated", true);
  const source = clip("source", body.source, 100, "source_truncated", false);
  const pageUrl = clip("page_url", body.page_url, URL_MAX, "page_url_truncated", false);
  const referrer = clip("referrer", body.referrer, URL_MAX, "referrer_truncated", false);
  const utm: LeadUtm = {};
  for (const [bodyKey, utmKey] of UTM_KEYS) {
    utm[utmKey] = clip(bodyKey, body[bodyKey], UTM_MAX, "utm_truncated", false);
  }

  // An e-mail that does not parse no longer costs the lead (§19.3 item 4):
  // the contact's e-mail stays unset, the submission keeps it as typed.
  let email: string | undefined;
  let invalidEmail: string | undefined;
  const rawEmail = body.email?.trim();
  if (rawEmail) {
    if (rawEmail.length <= EMAIL_MAX && z.string().email().safeParse(rawEmail).success) {
      email = rawEmail;
    } else {
      repairs.codes.add("email_invalid");
      invalidEmail = cutText(rawEmail, EMAIL_MAX);
      if (rawEmail.length > EMAIL_MAX) keepOriginal(repairs, "email", rawEmail);
    }
  }

  // Unknown top-level keys are folded into `fields` rather than stripped; an
  // explicit `fields` entry wins a clash.
  const extras = Object.entries(body).filter(([key]) => !KNOWN_KEYS.has(key));
  const merged = new Map<string, unknown>(extras);
  for (const [key, value] of Object.entries(body.fields ?? {})) merged.set(key, value);

  const kept: Array<[string, unknown]> = [];
  let fieldsBytes = 2;
  for (const [rawKey, rawValue] of merged) {
    if (isCredentialKey(rawKey)) continue;

    let key = rawKey;
    if (key.length > INGEST_LIMITS.fieldKeyLength) {
      key = cutText(key, INGEST_LIMITS.fieldKeyLength);
      keepOriginal(repairs, rawKey, asText(rawValue));
      repairs.codes.add("field_key_truncated");
    }
    if (kept.length >= INGEST_LIMITS.fieldKeys) {
      keepOriginal(repairs, rawKey, asText(rawValue));
      repairs.codes.add("fields_over_limit");
      continue;
    }

    let value = rawValue;
    if (typeof value === "string" && value.length > INGEST_LIMITS.fieldValueLength) {
      keepOriginal(repairs, rawKey, value);
      repairs.codes.add(`field_truncated:${key}`);
      value = truncateWithMark(value, INGEST_LIMITS.fieldValueLength);
    }

    const entryBytes = jsonBytes(key) + jsonBytes(value) + 2;
    if (fieldsBytes + entryBytes > INGEST_LIMITS.fieldsBytes) {
      keepOriginal(repairs, rawKey, asText(rawValue));
      repairs.codes.add("fields_too_large");
      continue;
    }
    fieldsBytes += entryBytes;
    kept.push([key, value]);
  }

  // Built with fromEntries (define, not assign), so a key named `__proto__`
  // is stored as data rather than touching the prototype.
  const payload: Record<string, unknown> = Object.fromEntries(kept);
  if (repairs.original.length > 0) payload._original = Object.fromEntries(repairs.original);
  if (repairs.originalCut.length > 0) payload._original_cut = repairs.originalCut;

  return {
    name,
    email,
    invalidEmail,
    message,
    source,
    utm,
    pageUrl,
    referrer,
    payload,
    needsReview: repairs.codes.size > 0 ? [...repairs.codes] : null,
  };
}

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

/**
 * Server-side-only ingest options — deliberately a separate argument from the
 * body, and never parsed out of a request (PLAN.md §18.1.4).
 *
 * `allowInactive` lets the Claude Ops test-lead step reach a site that is
 * still inactive because it has not been approved yet. It has exactly one
 * caller (`modules/ops/provision.ts`) and no route sets it: an inactive site
 * stays closed to /api/v1/leads and to the webhook lane, which is what makes
 * "inactive" mean anything.
 */
export type IngestOptions = {
  allowInactive?: boolean;
  /**
   * Leaves the site's health row alone. For the console's "send a test lead"
   * button, which exercises the CRM side (routing, pipeline) from inside the
   * server: recording it as a success would paint a site whose real form is
   * broken green on /platform-sites, which is the one thing health is for.
   */
  skipHealth?: boolean;
};

export async function ingestLead(
  apiKey: string | null,
  rawBody: unknown,
  meta: IngestRequestMeta = {},
): Promise<IngestOutcome> {
  if (!apiKey) return { ok: false, status: 401, error: "Missing API key" };

  const site = await resolveSiteByApiKey(apiKey);
  if (!site) {
    // A 401 normally has no site to charge it to. The one case that can be
    // attributed is a key this CRM issued and later revoked: record it on
    // that site so /sites can say "still sending the old key" instead of
    // showing a silent, idle site. Best-effort, and the answer stays 401.
    const revokedOwner = await findSiteByRevokedApiKey(apiKey).catch(() => null);
    if (revokedOwner) await recordIngestFailure(revokedOwner, "key", 401, "revoked-key");
    return { ok: false, status: 401, error: "Invalid API key" };
  }

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
  options: IngestOptions = {},
): Promise<IngestOutcome> {
  const outcome = await runIngest(site, rawBody, meta, lane, options);

  // Per-site health (§5.2). Recorded here, around the single engine, so both
  // lanes are covered by one call site and no failure path can forget. Never
  // awaited into the caller's error handling: bookkeeping must not fail an
  // ingest, and it stores no payload and no credential.
  if (options.skipHealth) {
    // See IngestOptions.skipHealth.
  } else if (outcome.ok) {
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
  options: IngestOptions,
): Promise<IngestOutcome> {
  if (!site.isActive && !options.allowInactive) {
    return { ok: false, status: 403, error: "Site is inactive" };
  }

  if (await rateLimited(lane, site.id)) {
    return { ok: false, status: 429, error: "Rate limit exceeded" };
  }

  // The one size that is still refused rather than repaired (§19.3 item 2).
  if (jsonBytes(rawBody) > INGEST_LIMITS.bodyBytes) {
    return { ok: false, status: 422, error: "Payload too large" };
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
    const lead = repairLeadBody(body);
    const result = await recordLeadSubmission(ctx, {
      siteId: site.id,
      phone: normalizePhone(body.phone, tenantSettings.defaultCountry ?? DEFAULT_COUNTRY),
      name: lead.name,
      email: lead.email,
      invalidEmail: lead.invalidEmail,
      message: lead.message,
      source: lead.source ?? `site:${site.slug}`,
      utm: lead.utm,
      pageUrl: lead.pageUrl,
      referrer: lead.referrer,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      idempotencyKey: body.idempotency_key,
      payload: lead.payload,
      needsReview: lead.needsReview,
      // Routing defaults come from the site record, never the caller — a
      // leaked key can't move leads into another pipeline (§5.1).
      defaults: {
        pipelineId: site.defaultPipelineId,
        stageId: site.defaultStageId,
        ownerUserId: site.defaultOwnerUserId,
        tagIds: (site.defaultTagIds as string[]) ?? [],
        dealTitle: cutText(`${site.name} — ${lead.name || body.phone}`, DEAL_TITLE_MAX),
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
