import {
  mysqlTable,
  char,
  varchar,
  text,
  json,
  datetime,
  bigint,
  int,
  boolean,
  mysqlEnum,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { generateId } from "@/lib/ids";
import { tenants } from "./tenancy";
import { user } from "./auth";

export const pipelines = mysqlTable(
  "pipelines",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    position: int("position").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("pipelines_tenant_id_idx").on(table.tenantId)],
);

export const stages = mysqlTable(
  "stages",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pipelineId: char("pipeline_id", { length: 26 })
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    position: int("position").notNull().default(0),
    color: varchar("color", { length: 20 }).notNull().default("#6b7280"),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("stages_tenant_id_idx").on(table.tenantId),
    index("stages_pipeline_id_idx").on(table.pipelineId),
  ],
);

export const contacts = mysqlTable(
  "contacts",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    email: varchar("email", { length: 255 }),
    notes: text("notes"),
    source: varchar("source", { length: 100 }),
    ownerUserId: char("owner_user_id", { length: 26 }).references(() => user.id),
    custom: json("custom").$type<Record<string, unknown>>(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("contacts_tenant_id_idx").on(table.tenantId),
    uniqueIndex("contacts_tenant_phone_idx").on(table.tenantId, table.phone),
    index("contacts_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const tags = mysqlTable(
  "tags",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }).notNull().default("#6b7280"),
    createdAt: datetime("created_at")
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
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: char("tag_id", { length: 26 })
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.contactId, table.tagId] }),
    index("contact_tags_tenant_id_idx").on(table.tenantId),
    index("contact_tags_tag_id_idx").on(table.tagId),
  ],
);

export const deals = mysqlTable(
  "deals",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    pipelineId: char("pipeline_id", { length: 26 })
      .notNull()
      .references(() => pipelines.id),
    stageId: char("stage_id", { length: 26 })
      .notNull()
      .references(() => stages.id),
    title: varchar("title", { length: 255 }).notNull(),
    value: bigint("value", { mode: "number" }),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    assignedUserId: char("assigned_user_id", { length: 26 }).references(() => user.id),
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
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("deals_tenant_id_idx").on(table.tenantId),
    index("deals_contact_id_idx").on(table.contactId),
    index("deals_stage_id_idx").on(table.stageId),
    index("deals_assigned_user_id_idx").on(table.assignedUserId),
  ],
);

export const activityTypeEnum = [
  "note",
  "call",
  "stage_change",
  "form_submission",
  "quote_sent",
  "system",
] as const;
export type ActivityType = (typeof activityTypeEnum)[number];

export const activities = mysqlTable(
  "activities",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    dealId: char("deal_id", { length: 26 }).references(() => deals.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", activityTypeEnum).notNull(),
    userId: char("user_id", { length: 26 }).references(() => user.id),
    payload: json("payload").$type<Record<string, unknown>>(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("activities_tenant_id_idx").on(table.tenantId),
    index("activities_contact_id_idx").on(table.contactId),
    index("activities_deal_id_idx").on(table.dealId),
  ],
);

