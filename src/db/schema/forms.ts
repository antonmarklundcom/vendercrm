import {
  mysqlTable,
  char,
  varchar,
  json,
  datetime,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { generateId } from "@/lib/ids";
import { tenants } from "./tenancy";
import { contacts } from "./crm";

export type FormField = {
  key: string;
  label: string;
  type: "text" | "phone" | "email" | "select" | "textarea";
  required: boolean;
  options?: string[];
};

export type FormSettings = {
  redirectUrl?: string;
  targetPipelineId?: string;
  targetStageId?: string;
  defaultTagIds?: string[];
};

export const forms = mysqlTable(
  "forms",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    fields: json("fields").$type<FormField[]>().notNull().default([]),
    settings: json("settings").$type<FormSettings>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("forms_tenant_id_idx").on(table.tenantId),
    uniqueIndex("forms_tenant_slug_idx").on(table.tenantId, table.slug),
  ],
);

export const formSubmissions = mysqlTable(
  "form_submissions",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    formId: char("form_id", { length: 26 })
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    data: json("data").$type<Record<string, unknown>>().notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 500 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("form_submissions_tenant_id_idx").on(table.tenantId),
    index("form_submissions_form_id_idx").on(table.formId),
    index("form_submissions_contact_id_idx").on(table.contactId),
  ],
);
