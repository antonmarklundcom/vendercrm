import {
  mysqlTable,
  char,
  varchar,
  int,
  json,
  datetime,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Platform-level audit trail (PLAN.md §4 "infra"). Every impersonated action
// is written here with both the real actor and the effective (impersonated)
// user — §3.2. Nullable tenant_id lets platform-level actions (e.g. tenant
// creation) be logged too, filterable per tenant in the superadmin console.
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }),
    actorUserId: char("actor_user_id", { length: 26 }).notNull(),
    impersonatorUserId: char("impersonator_user_id", { length: 26 }),
    action: varchar("action", { length: 100 }).notNull(),
    entity: varchar("entity", { length: 100 }).notNull(),
    entityId: varchar("entity_id", { length: 100 }).notNull(),
    payload: json("payload").notNull().default({}),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_log_tenant_id_idx").on(table.tenantId),
    index("audit_log_entity_idx").on(table.entity, table.entityId),
  ],
);

// Platform-level job queue (PLAN.md §2.1) — a `jobs` table drained by an
// in-process worker, no Redis. Delayed steps are just jobs with a future run_at.
export const jobs = mysqlTable(
  "jobs",
  {
    id: char("id", { length: 26 }).primaryKey(),
    type: varchar("type", { length: 100 }).notNull(),
    payload: json("payload").notNull(),
    tenantId: char("tenant_id", { length: 26 }),
    // fsp: 3 (millisecond precision) — MySQL *rounds* (not truncates) values
    // inserted into a DATETIME column with no fsp, so a run_at written at
    // e.g. .900s can round up to the next whole second and land in the
    // future relative to the immediately-following claim query. That made
    // "due now" jobs intermittently miss their own tick.
    runAt: datetime("run_at", { fsp: 3 }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "running", "done", "failed", "dead"],
    })
      .notNull()
      .default("pending"),
    attempts: int("attempts").notNull().default(0),
    maxAttempts: int("max_attempts").notNull().default(5),
    lockedAt: datetime("locked_at", { fsp: 3 }),
    lockedBy: varchar("locked_by", { length: 100 }),
    lastError: varchar("last_error", { length: 2000 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("jobs_status_run_at_idx").on(table.status, table.runAt),
    index("jobs_type_idx").on(table.type),
  ],
);

// Platform-level rate-limit windows (PLAN.md §14 I1 #1). The limiter used to
// live in process memory, which was only sound while Hostinger ran exactly
// one Node process: counts reset on every deploy and a second instance would
// have silently doubled every limit. One row per bucket makes the window
// survive restarts and hold across processes.
//
// `bucket_key` is the caller's own namespaced key ("auth:ip:1.2.3.4",
// "leads:api:<siteId>"), so a limited caller can be identified from the row
// without a join. Rows are disposable: `reset_at` in the past means the
// window is over, and maintenance sweeps them (worker/maintenance.ts).
export const rateLimitBuckets = mysqlTable(
  "rate_limit_buckets",
  {
    bucketKey: varchar("bucket_key", { length: 191 }).primaryKey(),
    hitCount: int("hit_count").notNull().default(0),
    // fsp: 3 for the same reason `jobs.run_at` has it: a DATETIME with no
    // fractional part *rounds*, which would push a window's end up to half a
    // second into the future and let one extra request through.
    resetAt: datetime("reset_at", { fsp: 3 }).notNull(),
  },
  (table) => [index("rate_limit_buckets_reset_at_idx").on(table.resetAt)],
);
