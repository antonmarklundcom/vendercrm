import {
  mysqlTable,
  char,
  varchar,
  int,
  json,
  boolean,
  datetime,
  index,
  unique,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenancy";
import { contacts } from "./crm";

// Automation flow builder (PLAN.md §4, §7). An interpreter over a stored graph
// with durable state — no in-memory workflow runtime, everything resumable
// from flow_runs.

export const flows = mysqlTable(
  "flows",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    status: varchar("status", {
      length: 16,
      enum: ["draft", "active", "paused"],
    })
      .notNull()
      .default("draft"),
    triggerType: varchar("trigger_type", {
      length: 32,
      enum: [
        "wa_message",
        "form_submitted",
        "deal_stage_changed",
        "contact_created",
        "tag_added",
      ],
    }).notNull(),
    // e.g. { keyword? } | { formId } | { pipelineId, stageId } | {} | { tagId }
    triggerConfig: json("trigger_config"),
    // Guard (PLAN.md §7.2): when true, any inbound reply from the contact
    // cancels their other active runs of this flow (except a run currently
    // parked at a wait_for_reply node, which resumes via the reply branch
    // instead — see automations/inbound.ts).
    stopOnReply: boolean("stop_on_reply").notNull().default(true),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("flows_tenant_idx").on(t.tenantId)],
);

// Publishing creates an immutable version; editing a published flow creates a
// new draft version. Runs pin to the version active when they were created.
export const flowVersions = mysqlTable(
  "flow_versions",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flowId: char("flow_id", { length: 26 })
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    version: int("version").notNull(),
    // { nodes: FlowNode[], edges: FlowEdge[] } — zod-validated on save
    // (single trigger, no orphans, no cycles).
    graph: json("graph").notNull(),
    publishedAt: datetime("published_at"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("flow_versions_tenant_idx").on(t.tenantId),
    index("flow_versions_flow_idx").on(t.flowId),
    unique("flow_versions_flow_version_uq").on(t.flowId, t.version),
  ],
);

export const flowRuns = mysqlTable(
  "flow_runs",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flowId: char("flow_id", { length: 26 })
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    flowVersionId: char("flow_version_id", { length: 26 })
      .notNull()
      .references(() => flowVersions.id),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: varchar("status", {
      length: 16,
      enum: ["running", "waiting", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("running"),
    currentNodeId: varchar("current_node_id", { length: 64 }),
    waitUntil: datetime("wait_until"),
    waitFor: varchar("wait_for", { length: 16, enum: ["delay", "reply"] }),
    // Execution-scoped variables (trigger payload + accumulated node outputs).
    context: json("context"),
    startedBy: json("started_by"),
    stepCount: int("step_count").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("flow_runs_tenant_idx").on(t.tenantId),
    index("flow_runs_flow_idx").on(t.flowId),
    index("flow_runs_contact_idx").on(t.contactId),
    // Not a DB-level unique constraint (MariaDB rejects string functions like
    // CONCAT over fixed-width CHAR columns in generated columns — every PK/FK
    // here is char(26)). "At most one active run per (flow, contact)"
    // (PLAN.md §7.2) is instead enforced in engine.ts via SELECT ... FOR
    // UPDATE on this composite index before inserting a new run — the same
    // locking pattern the job queue already uses (worker/claim.ts).
    index("flow_runs_flow_contact_idx").on(t.flowId, t.contactId),
    index("flow_runs_status_idx").on(t.status),
  ],
);

export const flowRunSteps = mysqlTable(
  "flow_run_steps",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: char("run_id", { length: 26 })
      .notNull()
      .references(() => flowRuns.id, { onDelete: "cascade" }),
    nodeId: varchar("node_id", { length: 64 }).notNull(),
    status: varchar("status", {
      length: 16,
      enum: ["ok", "error", "skipped"],
    }).notNull(),
    result: json("result"),
    executedAt: datetime("executed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("flow_run_steps_tenant_idx").on(t.tenantId),
    index("flow_run_steps_run_idx").on(t.runId),
  ],
);
