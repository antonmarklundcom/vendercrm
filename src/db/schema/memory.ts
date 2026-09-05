import {
  mysqlTable,
  char,
  varchar,
  int,
  json,
  datetime,
  index,
  uniqueIndex,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Memoria del negocio (PLAN.md §16.3): one structured, per-tenant record of
// everything a good employee knows on day one, and the single source the AI
// reply paths, the setup assistant, template variables and the public pages
// read from.
//
// Structured, not a blob (§16.2 rule 1). The five free-text fields this
// replaces (`settings.ai.businessName/about/tone/hours/neverPromise`) could
// only ever be pasted into a prompt whole; typed facts let the prompt
// builder pick the three that answer *this* customer's question, let the UI
// say "you have no cancellation policy", and — the load-bearing one — let
// `visibility: internal` be excluded at the query rather than by asking the
// model nicely (§16.2 rule 5).

/**
 * One row per tenant: the things that are true of the business itself, as
 * opposed to the many facts about what it sells and promises.
 *
 * A table rather than more `tenants.settings` JSON, unlike the AI config
 * next to it: this is tenant *data* that a form edits field by field, that
 * the setup assistant writes, and whose completion percentage the coach
 * reads — not a handful of switches.
 */
export const businessProfiles = mysqlTable(
  "business_profiles",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    /** What the business calls itself to customers; falls back to the tenant name. */
    displayName: varchar("display_name", { length: 200 }),
    legalName: varchar("legal_name", { length: 200 }),
    ruc: varchar("ruc", { length: 30 }),
    /** The preset applied by the setup assistant, if any. Bookkeeping only. */
    verticalSlug: varchar("vertical_slug", { length: 60 }),
    about: text("about"),
    /** How the assistant should sound. The free note carries the nuance. */
    tone: varchar("tone", { length: 10, enum: ["cercano", "formal", "directo"] }),
    toneNote: varchar("tone_note", { length: 500 }),
    audience: text("audience"),
    differentiators: text("differentiators"),
    /** Reserved for the day a tenant answers in more than one language. */
    languages: json("languages").$type<string[]>(),
    website: varchar("website", { length: 500 }),
    address: varchar("address", { length: 500 }),
    mapsUrl: varchar("maps_url", { length: 2000 }),
    /** Prices, delivery dates — whatever the model must never commit to. */
    neverPromise: text("never_promise"),
    paymentMethods: json("payment_methods").$type<string[]>(),
    /**
     * Derived from the checklist and cached here so the dashboard and the
     * coach can read one number without loading every fact.
     */
    completedPct: int("completed_pct").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("business_profiles_tenant_id_idx").on(table.tenantId)],
);

/**
 * Everything else the business knows, one fact per row.
 *
 * `source`/`confirmed_at` are the shape of §16.2 rule 2 — "the AI suggests, a
 * human confirms". A fact extracted from a pasted price list lands
 * `ai_suggested` with a null `confirmed_at` and is invisible to retrieval
 * until an admin confirms it, which is why the retrieval query filters on the
 * column instead of the caller remembering to.
 */
export const businessFacts = mysqlTable(
  "business_facts",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    kind: varchar("kind", {
      length: 10,
      enum: ["faq", "service", "policy", "location", "contact", "promo", "note"],
    }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    body: text("body"),
    /**
     * Per kind (§16.3): service → `{price, priceFrom, durationMinutes,
     * bookingTypeId?}`; promo → `{validFrom, validUntil}`; policy →
     * `{topic}`. Validated by zod in modules/memory/facts.ts, never here.
     */
    structured: json("structured").$type<Record<string, unknown>>(),
    tags: json("tags").$type<string[]>(),
    /** `internal` never reaches a customer-facing prompt (§16.2 rule 5). */
    visibility: varchar("visibility", { length: 10, enum: ["customer", "internal"] })
      .notNull()
      .default("customer"),
    source: varchar("source", { length: 12, enum: ["manual", "imported", "ai_suggested"] })
      .notNull()
      .default("manual"),
    confirmedAt: datetime("confirmed_at"),
    confirmedByUserId: char("confirmed_by_user_id", { length: 26 }),
    /** "Ask me again after this date" — promos and prices go stale. */
    reviewAfter: datetime("review_after"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("business_facts_tenant_kind_idx").on(table.tenantId, table.kind),
    // The retrieval filter: tenant, then customer-visible-and-confirmed.
    index("business_facts_tenant_visibility_idx").on(
      table.tenantId,
      table.visibility,
      table.confirmedAt,
    ),
    // A FULLTEXT index on (title, body) is created by the migration —
    // drizzle-kit's MySQL dialect has no way to express one, and MATCH …
    // AGAINST is how FAQs and services are retrieved without a vector
    // database (§16.2 rule 4). Do not drop it by regenerating this file.
  ],
);

/**
 * One row per "here is a price list / a PDF / our website, learn it" —
 * the audit trail for facts nobody typed. K3 fills this in; the table is
 * created now so K2 and K3 add no migrations of their own (§16.6).
 */
export const memoryImports = mysqlTable(
  "memory_imports",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    sourceKind: varchar("source_kind", { length: 5, enum: ["text", "pdf", "url"] }).notNull(),
    /** Storage key or URL — never the pasted text itself. */
    sourceRef: varchar("source_ref", { length: 2000 }),
    status: varchar("status", {
      length: 10,
      enum: ["pending", "extracted", "reviewed", "failed"],
    })
      .notNull()
      .default("pending"),
    extractedCount: int("extracted_count").notNull().default(0),
    /** The `ai_replies` row that did the extraction — cost and prompt audit. */
    aiReplyId: char("ai_reply_id", { length: 26 }),
    error: varchar("error", { length: 2000 }),
    createdBy: char("created_by", { length: 26 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("memory_imports_tenant_created_idx").on(table.tenantId, table.createdAt)],
);

/**
 * What the setup assistant proposed, and what applying it did (§16.3).
 * Keeping the plan is what makes "what did the AI set up?" answerable a
 * month later. K2 writes these rows.
 */
export const setupPlans = mysqlTable(
  "setup_plans",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    status: varchar("status", { length: 10, enum: ["draft", "applied", "discarded"] })
      .notNull()
      .default("draft"),
    /** The conversation summary the plan was generated from. */
    brief: text("brief"),
    /** The zod-validated `VerticalPreset` — data in the preset shape (§16.2 rule 3). */
    preset: json("preset").$type<Record<string, unknown>>(),
    /** The `ApplyOutcome` of applyVerticalPreset, stored on apply. */
    outcome: json("outcome").$type<Record<string, unknown>>(),
    aiReplyId: char("ai_reply_id", { length: 26 }),
    createdBy: char("created_by", { length: 26 }),
    appliedAt: datetime("applied_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("setup_plans_tenant_created_idx").on(table.tenantId, table.createdAt)],
);
