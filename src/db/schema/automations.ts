import {
  mysqlTable,
  char,
  varchar,
  int,
  json,
  datetime,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Automation flow builder (PLAN.md §4 "automations", §7). The engine is an
// interpreter over the stored graph with durable state — nothing lives in
// memory, every run is resumable from these tables after a restart (§7.2).

export const flows = mysqlTable(
  "flows",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["draft", "active", "paused"],
    })
      .notNull()
      .default("draft"),
    triggerType: varchar("trigger_type", {
      length: 40,
      enum: [
        "wa_message_received",
        "form_submitted",
        "lead_received",
        "deal_stage_changed",
        "contact_created",
        "tag_added",
        // Booking (docs/SPEC-BOOKING.md §7). The column is a varchar with a
        // drizzle-level enum, so widening it is a type change with no
        // migration and nothing to backfill.
        "booking_created",
        "booking_cancelled",
        "booking_no_show",
        // Completed is the review-request moment (plan-booking.md §6.1): the
        // only point at which asking for a reseña is a thank-you rather than
        // a guess.
        "booking_completed",
        "chat_lead_captured",
      ],
    }).notNull(),
    triggerConfig: json("trigger_config").notNull().default({}),
    // Points at the flow_versions row new runs pin to. Null while the flow
    // has never been published.
    publishedVersionId: char("published_version_id", { length: 26 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("flows_tenant_id_idx").on(table.tenantId),
    index("flows_tenant_trigger_idx").on(table.tenantId, table.triggerType, table.status),
  ],
);

// Immutable once published: a run pins to the version it started on, so
// editing a live flow can never change the shape of a run already in
// flight (§4, §7.1).
export const flowVersions = mysqlTable(
  "flow_versions",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    flowId: char("flow_id", { length: 26 }).notNull(),
    version: int("version").notNull(),
    // { nodes: [...], edges: [...] } — zod-validated on save (§7.1).
    graph: json("graph").notNull().default({}),
    publishedAt: datetime("published_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("flow_versions_tenant_id_idx").on(table.tenantId),
    uniqueIndex("flow_versions_flow_version_idx").on(table.flowId, table.version),
  ],
);

export const flowRuns = mysqlTable(
  "flow_runs",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    flowId: char("flow_id", { length: 26 }).notNull(),
    flowVersionId: char("flow_version_id", { length: 26 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["running", "waiting", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("running"),
    currentNodeId: varchar("current_node_id", { length: 100 }),
    waitUntil: datetime("wait_until"),
    waitFor: varchar("wait_for", { length: 10, enum: ["delay", "reply"] }),
    context: json("context").notNull().default({}),
    startedBy: json("started_by").notNull().default({}),
    stepCount: int("step_count").notNull().default(0),
    lastError: varchar("last_error", { length: 2000 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("flow_runs_tenant_id_idx").on(table.tenantId),
    // "Max one running run per (flow, contact)" (§7.2 guards) is checked
    // against this index.
    index("flow_runs_flow_contact_idx").on(table.flowId, table.contactId, table.status),
    // The inbound-message processor looks up waiting runs by contact to
    // resume wait-for-reply nodes.
    index("flow_runs_tenant_contact_status_idx").on(table.tenantId, table.contactId, table.status),
  ],
);

export const flowRunSteps = mysqlTable(
  "flow_run_steps",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    runId: char("run_id", { length: 26 }).notNull(),
    nodeId: varchar("node_id", { length: 100 }).notNull(),
    nodeType: varchar("node_type", { length: 40 }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["ok", "skipped", "failed"],
    }).notNull(),
    result: json("result").notNull().default({}),
    executedAt: datetime("executed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("flow_run_steps_tenant_id_idx").on(table.tenantId),
    index("flow_run_steps_run_id_idx").on(table.runId),
  ],
);
