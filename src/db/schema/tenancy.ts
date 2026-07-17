import {
  mysqlTable,
  char,
  varchar,
  json,
  datetime,
  index,
  unique,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Platform-level tenancy tables (PLAN.md §3.1, §4). `tenants` is the FK target
// for every tenant-owned table's tenant_id.

export const tenants = mysqlTable(
  "tenants",
  {
    id: char("id", { length: 26 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    status: varchar("status", {
      length: 20,
      enum: ["active", "suspended", "trial"],
    })
      .notNull()
      .default("trial"),
    locale: varchar("locale", { length: 10 }).notNull().default("es"),
    timezone: varchar("timezone", { length: 64 })
      .notNull()
      .default("America/Asuncion"),
    settings: json("settings"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
);

// Tenant-owned: a tenant admin invites users into their own tenant. Scoped
// through tenantDb for management; looked up by token (unbound) at accept time.
export const invitations = mysqlTable(
  "invitations",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 10, enum: ["admin", "agent"] })
      .notNull()
      .default("agent"),
    token: varchar("token", { length: 64 }).notNull().unique(),
    invitedByUserId: char("invited_by_user_id", { length: 26 }),
    expiresAt: datetime("expires_at").notNull(),
    acceptedAt: datetime("accepted_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("invitations_tenant_id_idx").on(table.tenantId),
    // One outstanding invite per email per tenant.
    unique("invitations_tenant_email_uq").on(table.tenantId, table.email),
  ],
);
