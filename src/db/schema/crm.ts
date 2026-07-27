import {
  mysqlTable,
  char,
  varchar,
  int,
  bigint,
  boolean,
  json,
  datetime,
  index,
  uniqueIndex,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// CRM core (PLAN.md §4 "crm", §5). All tenant-owned — every table carries
// tenant_id and is only ever reached through tenantDb(ctx) (§3.3).

export const pipelines = mysqlTable(
  "pipelines",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    position: int("position").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("pipelines_tenant_id_idx").on(table.tenantId)],
);

export const stages = mysqlTable(
  "stages",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    pipelineId: char("pipeline_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    position: int("position").notNull().default(0),
    color: varchar("color", { length: 20 }),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("stages_tenant_id_idx").on(table.tenantId),
    index("stages_pipeline_id_idx").on(table.pipelineId),
  ],
);

// Phone (E.164) is the primary identity key (§5) — unique per tenant so the
// same number can't create two contacts, but two tenants can share a number.
export const contacts = mysqlTable(
  "contacts",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    email: varchar("email", { length: 320 }),
    notes: text("notes"),
    source: varchar("source", { length: 100 }),
    ownerUserId: char("owner_user_id", { length: 26 }),
    // First-touch attribution (§5.1): stamped once when the contact is
    // created and never overwritten, so "which site/campaign originally
    // produced this customer" survives every later interaction. Each
    // submission keeps its own last-touch set in lead_submissions.utm.
    firstSiteId: char("first_site_id", { length: 26 }),
    firstTouchUtm: json("first_touch_utm"),
    custom: json("custom").notNull().default({}),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("contacts_tenant_id_idx").on(table.tenantId),
    uniqueIndex("contacts_tenant_phone_idx").on(table.tenantId, table.phone),
    index("contacts_tenant_owner_idx").on(table.tenantId, table.ownerUserId),
  ],
);

export const tags = mysqlTable(
  "tags",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("tags_tenant_id_idx").on(table.tenantId),
    uniqueIndex("tags_tenant_name_idx").on(table.tenantId, table.name),
  ],
);

export const contactTags = mysqlTable(
  "contact_tags",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    tagId: char("tag_id", { length: 26 }).notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("contact_tags_tenant_id_idx").on(table.tenantId),
    uniqueIndex("contact_tags_contact_tag_idx").on(table.contactId, table.tagId),
    index("contact_tags_tag_id_idx").on(table.tagId),
  ],
);

export const deals = mysqlTable(
  "deals",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    pipelineId: char("pipeline_id", { length: 26 }).notNull(),
    stageId: char("stage_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    assignedUserId: char("assigned_user_id", { length: 26 }),
    // Which site produced this deal. Null for deals created by hand in the
    // CRM. This is the column per-user site scoping filters the pipeline on
    // (PLAN.md §5.2) — without it a site-restricted user could not be shown
    // a correct kanban at all.
    siteId: char("site_id", { length: 26 }),
    // Kanban order within its stage — dragged deals get renumbered on drop.
    position: int("position").notNull().default(0),
    stageEnteredAt: datetime("stage_entered_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    closedAt: datetime("closed_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("deals_tenant_id_idx").on(table.tenantId),
    index("deals_tenant_stage_idx").on(table.tenantId, table.stageId),
    index("deals_tenant_contact_idx").on(table.tenantId, table.contactId),
    index("deals_tenant_assigned_idx").on(table.tenantId, table.assignedUserId),
    index("deals_tenant_site_idx").on(table.tenantId, table.siteId),
  ],
);

// Polymorphic timeline (§4): contact-level always; deal-level, form, and
// WhatsApp events attach via their own FK columns as those modules land.
export const activities = mysqlTable(
  "activities",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    dealId: char("deal_id", { length: 26 }),
    type: varchar("type", {
      length: 30,
      enum: ["note", "call", "stage_change", "form_submission", "quote_sent", "system"],
    }).notNull(),
    payload: json("payload").notNull().default({}),
    userId: char("user_id", { length: 26 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("activities_tenant_contact_idx").on(table.tenantId, table.contactId),
    index("activities_tenant_deal_idx").on(table.tenantId, table.dealId),
  ],
);
