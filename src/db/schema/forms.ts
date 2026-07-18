import {
  mysqlTable,
  char,
  varchar,
  boolean,
  json,
  datetime,
  text,
  index,
  unique,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenancy";
import { contacts } from "./crm";

// Public lead-capture forms (PLAN.md §4, §5).

export const forms = mysqlTable(
  "forms",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    // Ordered field defs: [{ key, label, type, required }] — text/phone/email/
    // select/textarea.
    fields: json("fields").notNull(),
    // { redirectUrl?, targetPipelineId?, targetStageId?, defaultTagIds?[] }.
    settings: json("settings"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("forms_tenant_idx").on(t.tenantId),
    unique("forms_tenant_slug_uq").on(t.tenantId, t.slug),
  ],
);

export const formSubmissions = mysqlTable(
  "form_submissions",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    formId: char("form_id", { length: 26 })
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 }).references(() => contacts.id, {
      onDelete: "set null",
    }),
    data: json("data").notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("form_submissions_tenant_idx").on(t.tenantId),
    index("form_submissions_form_idx").on(t.formId),
  ],
);
