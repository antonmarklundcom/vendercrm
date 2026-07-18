import {
  mysqlTable,
  char,
  varchar,
  bigint,
  boolean,
  int,
  json,
  datetime,
  text,
  index,
  unique,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenancy";

// CRM core (PLAN.md §4). Every table is tenant-owned: `tenant_id` FK to
// `tenants`, composite indexes lead with tenant_id, tenant-scoped uniqueness is
// always (tenant_id, x).

export const pipelines = mysqlTable(
  "pipelines",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    position: int("position").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("pipelines_tenant_idx").on(t.tenantId)],
);

export const stages = mysqlTable(
  "stages",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pipelineId: char("pipeline_id", { length: 26 })
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    position: int("position").notNull().default(0),
    color: varchar("color", { length: 20 }),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("stages_tenant_idx").on(t.tenantId),
    index("stages_pipeline_idx").on(t.pipelineId),
  ],
);

export const contacts = mysqlTable(
  "contacts",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    // E.164, unique per tenant (nullable — some contacts are email-only).
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    notes: text("notes"),
    source: varchar("source", { length: 100 }),
    ownerUserId: char("owner_user_id", { length: 26 }),
    custom: json("custom"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("contacts_tenant_idx").on(t.tenantId),
    unique("contacts_tenant_phone_uq").on(t.tenantId, t.phone),
  ],
);

export const tags = mysqlTable(
  "tags",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    color: varchar("color", { length: 20 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("tags_tenant_idx").on(t.tenantId),
    unique("tags_tenant_name_uq").on(t.tenantId, t.name),
  ],
);

export const contactTags = mysqlTable(
  "contact_tags",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: char("tag_id", { length: 26 })
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("contact_tags_tenant_idx").on(t.tenantId),
    unique("contact_tags_uq").on(t.contactId, t.tagId),
  ],
);

export const deals = mysqlTable(
  "deals",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    pipelineId: char("pipeline_id", { length: 26 })
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    stageId: char("stage_id", { length: 26 })
      .notNull()
      .references(() => stages.id),
    title: varchar("title", { length: 255 }).notNull(),
    value: bigint("value", { mode: "number" }),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    assignedUserId: char("assigned_user_id", { length: 26 }),
    // Kanban order within a stage.
    position: int("position").notNull().default(0),
    stageEnteredAt: datetime("stage_entered_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    closedAt: datetime("closed_at"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("deals_tenant_idx").on(t.tenantId),
    index("deals_stage_idx").on(t.stageId),
    index("deals_contact_idx").on(t.contactId),
  ],
);

// Polymorphic timeline entry (PLAN.md §4).
export const activities = mysqlTable(
  "activities",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    dealId: char("deal_id", { length: 26 }),
    type: varchar("type", {
      length: 30,
      enum: [
        "note",
        "call",
        "stage_change",
        "form_submission",
        "quote_sent",
        "system",
      ],
    }).notNull(),
    payload: json("payload"),
    userId: char("user_id", { length: 26 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("activities_tenant_idx").on(t.tenantId),
    index("activities_contact_idx").on(t.contactId),
    index("activities_deal_idx").on(t.dealId),
  ],
);
