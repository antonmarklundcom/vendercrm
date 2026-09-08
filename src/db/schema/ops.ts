import {
  mysqlTable,
  char,
  varchar,
  json,
  datetime,
  text,
  int,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Claude Ops (PLAN.md §18): provisioning a new site's CRM side from the same
// Claude Code session that builds the website, with a long-lived token the
// owner holds on his PC.
//
// None of these tables carries a `tenant_id`, and that is deliberate: they
// are platform-level bookkeeping *about* provisioning, owned by a superadmin,
// the same way `tenants` itself is. Tenant data created through them lives in
// the ordinary tenant-scoped tables and is reached through tenantDb like
// everything else.

// One token per owner PC (§18.1.1). Hashed at rest with a visible prefix,
// exactly like `site_api_keys` — nothing ever reads a token back, only
// compares one. Revoke is a timestamp, so "which token provisioned this
// site" survives the revocation.
export const opsTokens = mysqlTable(
  "ops_tokens",
  {
    id: char("id", { length: 26 }).primaryKey(),
    /** The superadmin the token acts as. Every audit row it writes names
     * this user as the actor — a token is a credential, not an identity. */
    ownerUserId: char("owner_user_id", { length: 26 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
    /**
     * Existing tenants this token may add a *new* site to (§18.1.3). An
     * explicit list of ids, never a wildcard: the empty default means the
     * token can only work in tenants it created itself.
     */
    allowedTenantIds: json("allowed_tenant_ids").notNull().default([]),
    /** Null = no expiry, the default the owner's PC runs on. */
    expiresAt: datetime("expires_at"),
    revokedAt: datetime("revoked_at"),
    lastUsedAt: datetime("last_used_at"),
    callCount: int("call_count").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("ops_tokens_owner_idx").on(table.ownerUserId),
    // Resolution is a single indexed equality match on the hash, like the
    // ingest key lookup it is modelled on.
    uniqueIndex("ops_tokens_hash_idx").on(table.tokenHash),
  ],
);

// The unit of work (§18.1.5), and optional: a session may create a batch
// with a one-line title for a single site, or the owner may paste a list of
// domains on the page and let the session write the rows.
export const opsBatches = mysqlTable(
  "ops_batches",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tokenId: char("token_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    /** The owner's raw text, exactly as pasted. Never parsed server-side —
     * the session reads it and writes the rows it understands. */
    rawText: text("raw_text"),
    /** open | done | archived */
    status: varchar("status", { length: 20 }).notNull().default("open"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("ops_batches_token_idx").on(table.tokenId)],
);

// One row per domain, carrying the five step states and everything the page
// needs to show what happened (§18.1.7: a failure is stored verbatim, so the
// owner reads the real reason rather than "something went wrong").
export const opsBatchRows = mysqlTable(
  "ops_batch_rows",
  {
    id: char("id", { length: 26 }).primaryKey(),
    batchId: char("batch_id", { length: 26 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    /** new | existing — `existing` requires the tenant to be allowlisted. */
    tenantMode: varchar("tenant_mode", { length: 10 }).notNull().default("new"),
    tenantId: char("tenant_id", { length: 26 }),
    /** stages[], owner_email, tags[], wa_account_id, notes, admin_* — what
     * the pipeline and tenant steps read. Written by the session. */
    details: json("details").notNull().default({}),
    /** pending | running | needs_input | failed | awaiting_approval | live */
    state: varchar("state", { length: 20 }).notNull().default("pending"),
    /** { tenant, site, pipeline, key, test_lead } → { status, at } */
    steps: json("steps").notNull().default({}),
    /** { step, status, reason } — the endpoint's own words, not a summary. */
    lastError: json("last_error"),
    needsInput: text("needs_input"),
    siteId: char("site_id", { length: 26 }),
    pipelineId: char("pipeline_id", { length: 26 }),
    apiKeyId: char("api_key_id", { length: 26 }),
    testContactId: char("test_contact_id", { length: 26 }),
    testDealId: char("test_deal_id", { length: 26 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("ops_batch_rows_batch_idx").on(table.batchId)],
);

/**
 * The guard's memory (§18.1.2). Every object an ops token creates is written
 * here, and "may this token touch X" is answered by this table alone: a
 * tenant, site, pipeline or key that predates the token is not in it, so the
 * token cannot see it, and no endpoint has to remember to check.
 *
 * Unique on (entity, entity_id) rather than (token, entity, entity_id): an
 * object belongs to the one token that created it, and a second token
 * claiming the same site would be a bug worth failing on rather than a
 * second grant.
 */
export const opsObjects = mysqlTable(
  "ops_objects",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tokenId: char("token_id", { length: 26 }).notNull(),
    batchId: char("batch_id", { length: 26 }),
    rowId: char("row_id", { length: 26 }),
    /** tenant | site | pipeline | api_key | user | contact | deal */
    entity: varchar("entity", { length: 20 }).notNull(),
    entityId: char("entity_id", { length: 26 }).notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("ops_objects_token_idx").on(table.tokenId),
    index("ops_objects_row_idx").on(table.rowId),
    uniqueIndex("ops_objects_entity_idx").on(table.entity, table.entityId),
  ],
);
