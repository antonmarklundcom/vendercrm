import {
  mysqlTable,
  char,
  varchar,
  boolean,
  json,
  datetime,
  index,
  uniqueIndex,
  text,
  int,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Multi-site lead ingest (PLAN.md §5.1). One tenant owns many sites — the
// owner's whole Paraguayan lead-gen network is a single tenant, and every
// lead carries site_id for filtering and attribution.

export const sites = mysqlTable(
  "sites",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    domain: varchar("domain", { length: 255 }),
    // API keys used to live here, one hash per site. They now live in
    // `site_api_keys` below so a site can hold two live keys through a
    // rotation (§5.2); the migration backfills the existing key into that
    // table before dropping these columns, so no site loses its key.
    isActive: boolean("is_active").notNull().default(true),
    // Inbound webhook lane (PLAN.md §5.2). A long random per-site token that
    // travels in the URL path of POST /api/v1/hooks/[token], for client
    // sites on Elementor/Wix/Webflow/Zapier that cannot hold a server-side
    // secret. Hashed at rest exactly like an API key, but deliberately a
    // *separate* credential: it is weaker (URLs leak into third-party logs),
    // so it carries its own rate limit and is revoked on its own — setting
    // this to null kills the webhook without touching the site's API keys.
    hookTokenHash: char("hook_token_hash", { length: 64 }),
    hookTokenPrefix: varchar("hook_token_prefix", { length: 16 }),
    hookTokenLastUsedAt: datetime("hook_token_last_used_at"),
    // Per-site routing defaults, configured in the CRM and never accepted
    // from the caller — a leaked key can't reshape someone's pipeline.
    // Different sites are different businesses (dentista vs materiales), so
    // each normally points at its own pipeline.
    defaultPipelineId: char("default_pipeline_id", { length: 26 }),
    defaultStageId: char("default_stage_id", { length: 26 }),
    defaultOwnerUserId: char("default_owner_user_id", { length: 26 }),
    defaultTagIds: json("default_tag_ids").notNull().default([]),
    // Which WhatsApp number this site's conversations run through. Each site
    // is usually its own brand with its own number; null falls back to the
    // tenant's primary account.
    waAccountId: char("wa_account_id", { length: 26 }),
    settings: json("settings").notNull().default({}),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("sites_tenant_id_idx").on(table.tenantId),
    uniqueIndex("sites_tenant_slug_idx").on(table.tenantId, table.slug),
    // MySQL allows repeated NULLs in a unique index, so every site without a
    // webhook token coexists happily here.
    uniqueIndex("sites_hook_token_hash_idx").on(table.hookTokenHash),
  ],
);

// API keys for the server-to-server ingest lane (PLAN.md §5.2). Split out of
// `sites` so a site can hold **two live keys at once**: the single-column
// model made rotation a cutover — the moment a new key was issued the old one
// stopped working, so every site went down for the window between "issue" and
// "the new key is deployed on the site". Two active keys turn that into
// issue → deploy → revoke, with no gap.
//
// Keys stay SHA-256 hashed and are shown in plaintext exactly once (§5.1).
export const siteApiKeys = mysqlTable(
  "site_api_keys",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    siteId: char("site_id", { length: 26 }).notNull(),
    apiKeyHash: char("api_key_hash", { length: 64 }).notNull(),
    // First chars of the plaintext, so the UI can tell two keys apart after
    // the one-time reveal.
    apiKeyPrefix: varchar("api_key_prefix", { length: 16 }).notNull(),
    // Free-text note from the admin ("hosting viejo", "deploy nuevo").
    label: varchar("label", { length: 100 }),
    // What makes revoking the old key *safe*: the UI can show which key the
    // site is actually sending with before anything is turned off. Written
    // on the ingest path, throttled (see modules/sites/keys.ts).
    lastUsedAt: datetime("last_used_at"),
    // Revocation is a timestamp, not a delete: an audit of which key was
    // live when a lead arrived survives the rotation.
    revokedAt: datetime("revoked_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("site_api_keys_tenant_id_idx").on(table.tenantId),
    index("site_api_keys_site_id_idx").on(table.siteId),
    // Ingest routing is a single indexed equality match on the hash, exactly
    // as it was when the hash lived on `sites`.
    uniqueIndex("site_api_keys_hash_idx").on(table.apiKeyHash),
  ],
);

// Capture mode (PLAN.md §5.2): the last N raw payloads a site's webhook
// received while it had no field mapping yet. This is what makes the feature
// usable by a non-developer — send one test submission from Elementor, then
// build the mapping against the shape that actually arrived instead of
// guessing at documentation.
//
// Deliberately bounded and deliberately temporary: capture only runs while a
// site has no mapping, the oldest rows are trimmed past the cap, and nothing
// here is a lead — a captured payload has not been written to the CRM.
export const siteHookCaptures = mysqlTable(
  "site_hook_captures",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    siteId: char("site_id", { length: 26 }).notNull(),
    payload: json("payload").notNull().default({}),
    contentType: varchar("content_type", { length: 100 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("site_hook_captures_tenant_id_idx").on(table.tenantId),
    index("site_hook_captures_site_id_idx").on(table.siteId),
  ],
);

// Per-site ingest health (PLAN.md §5.2). One row per site, upserted on every
// ingest attempt on either lane.
//
// The problem it solves: when a client site's integration breaks, it breaks
// on THEIR server. The CRM simply stops receiving — and "no leads today" and
// "no leads because the form has been 422ing since Tuesday" look identical
// from the pipeline. The owner finds out days later, from the customer.
//
// Deliberately a summary, not a log: last success, last error (status +
// short reason) and running counts. **No payloads and no credentials are
// stored here** — a reason is a short code like "phone-missing", never the
// submitted data and never a token.
export const siteIngestHealth = mysqlTable(
  "site_ingest_health",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    siteId: char("site_id", { length: 26 }).notNull(),
    /**
     * Whether the LAST attempt succeeded: "ok" or "error". An explicit
     * column rather than comparing the two timestamps below, because
     * `datetime` has second precision — a failure in the same second as the
     * preceding success compares equal, and the site reads as healthy while
     * it is broken. (Caught by CI, not by hand: the two timestamps really do
     * land in the same second on a fast test run.)
     */
    lastOutcome: varchar("last_outcome", { length: 10 }),
    lastSuccessAt: datetime("last_success_at"),
    /** Which lane the last success arrived on: "key" or "hook". */
    lastSuccessLane: varchar("last_success_lane", { length: 10 }),
    lastErrorAt: datetime("last_error_at"),
    lastErrorStatus: int("last_error_status"),
    lastErrorReason: varchar("last_error_reason", { length: 200 }),
    lastErrorLane: varchar("last_error_lane", { length: 10 }),
    /**
     * What the owner was last *told* about this site, so a daily alert run
     * notifies on the transition rather than every day forever: "failing",
     * "stale", or null once the site is healthy again (which re-arms it).
     * Separate from lastOutcome — that is what happened, this is what was
     * sent.
     */
    alertedFor: varchar("alerted_for", { length: 10 }),
    alertedAt: datetime("alerted_at"),
    successCount: int("success_count").notNull().default(0),
    errorCount: int("error_count").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("site_ingest_health_tenant_id_idx").on(table.tenantId),
    // One row per site — the upsert target.
    uniqueIndex("site_ingest_health_site_id_idx").on(table.siteId),
  ],
);

// One row per inbound lead, from either entry path (§5.1): the public API
// (site_id set) or a hosted form page (form_id set). Replaces the old
// form_submissions table so attribution and per-source stats live in one
// place instead of two near-identical tables every query would UNION.
export const leadSubmissions = mysqlTable(
  "lead_submissions",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    siteId: char("site_id", { length: 26 }),
    formId: char("form_id", { length: 26 }),
    // The third entry path (docs/SPEC-BOOKING.md): a public booking. Exactly
    // one of the three is set. A booking *is* a lead — it arrives from a page
    // with UTMs and a referrer — so it belongs in the one attribution table
    // §5.1 exists to keep, rather than in a fourth place every dashboard
    // query would have to UNION.
    bookingTypeId: char("booking_type_id", { length: 26 }),
    contactId: char("contact_id", { length: 26 }).notNull(),
    dealId: char("deal_id", { length: 26 }),
    payload: json("payload").notNull().default({}),
    // utm_source/medium/campaign/term/content + gclid/fbclid (§5.1).
    utm: json("utm").notNull().default({}),
    pageUrl: varchar("page_url", { length: 2000 }),
    referrer: varchar("referrer", { length: 2000 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }),
    // Caller-supplied dedupe key. Null for the hosted-form path, which has
    // no retrying client; MySQL allows repeated NULLs in a unique index, so
    // form rows never collide with each other.
    idempotencyKey: varchar("idempotency_key", { length: 100 }),
    notes: text("notes"),
    // What this submission itself was sent with (§19.3). The contact only
    // learns name/e-mail when it is created, so a returning contact's later
    // details live here and nowhere else. `submitted_email` is kept as typed,
    // even when it failed validation and never reached the contact.
    submittedName: varchar("submitted_name", { length: 200 }),
    submittedEmail: varchar("submitted_email", { length: 320 }),
    submittedPhone: varchar("submitted_phone", { length: 30 }),
    source: varchar("source", { length: 100 }),
    // Repair codes from the ingest guard (`email_invalid`,
    // `message_truncated`, ...); null when nothing had to be repaired.
    needsReview: json("needs_review").$type<string[]>(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("lead_submissions_tenant_id_idx").on(table.tenantId),
    index("lead_submissions_site_id_idx").on(table.siteId),
    index("lead_submissions_form_id_idx").on(table.formId),
    index("lead_submissions_booking_type_id_idx").on(table.bookingTypeId),
    index("lead_submissions_contact_id_idx").on(table.contactId),
    // Date-bounded cross-account listing (PLAN.md §19.4).
    index("lead_submissions_created_at_idx").on(table.createdAt),
    // The idempotency guard (§5.1) — a retried POST is a no-op rather than a
    // duplicate contact, same discipline as wa_message_id in §6.3.
    uniqueIndex("lead_submissions_idempotency_idx").on(
      table.tenantId,
      table.siteId,
      table.idempotencyKey,
    ),
  ],
);
