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

// Platform-level tenancy & billing tables (PLAN.md §3.1, §4 "tenancy/billing").
// Manual billing only in Phase 1: superadmin records payments; no gateway.

export const tenants = mysqlTable(
  "tenants",
  {
    id: char("id", { length: 26 }).primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["active", "suspended", "trial"],
    })
      .notNull()
      .default("trial"),
    locale: varchar("locale", { length: 10 }).notNull().default("es"),
    timezone: varchar("timezone", { length: 60 })
      .notNull()
      .default("America/Asuncion"),
    settings: json("settings").notNull().default({}),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("tenants_slug_idx").on(table.slug)],
);

// Users belong to exactly one tenant (nullable only for superadmins, whose
// tenant_id is NULL — PLAN.md §3.1/§3.2). Doubles as the Better Auth `user`
// table (email, name, emailVerified, image are Better Auth core fields).
export const users = mysqlTable(
  "users",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }),
    email: varchar("email", { length: 320 }).notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: varchar("name", { length: 200 }).notNull(),
    image: varchar("image", { length: 2000 }),
    // Tenant role (admin|agent). Superadmins additionally get role="superadmin"
    // so Better Auth's admin-plugin `adminRoles` gate (§3.2) can key off it as
    // defense-in-depth for its own /api/auth/admin/* endpoints — the app's own
    // authorization never trusts this field alone, only `isSuperadmin` below
    // (resolved via getTenantContext/getSuperadminContext, PLAN.md §3.3).
    role: varchar("role", { length: 20, enum: ["admin", "agent", "client", "superadmin"] }),
    isSuperadmin: boolean("is_superadmin").notNull().default(false),
    // Better Auth admin plugin ban fields.
    banned: boolean("banned").notNull().default(false),
    banReason: varchar("ban_reason", { length: 500 }),
    banExpires: datetime("ban_expires"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_tenant_id_idx").on(table.tenantId),
  ],
);

export const invitations = mysqlTable(
  "invitations",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    role: varchar("role", { length: 20, enum: ["admin", "agent", "client"] }).notNull(),
    token: varchar("token", { length: 64 }).notNull(),
    invitedBy: char("invited_by", { length: 26 }).notNull(),
    acceptedAt: datetime("accepted_at"),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("invitations_token_idx").on(table.token),
    index("invitations_tenant_id_idx").on(table.tenantId),
    index("invitations_tenant_email_idx").on(table.tenantId, table.email),
  ],
);

export const plans = mysqlTable("plans", {
  id: char("id", { length: 26 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  // 3, 6, or 12 months — enforced by zod in the service layer (§1.2 prepay-only).
  durationMonths: int("duration_months").notNull(),
  // BIGINT minor units; PYG has 0 decimals so this is guaraníes as-is (§2.3).
  price: bigint("price", { mode: "number" }).notNull(),
  limits: json("limits").notNull().default({}),
  features: json("features").notNull().default({ factura_electronica: "coming_soon" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: datetime("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    planId: char("plan_id", { length: 26 }).notNull(),
    startsAt: datetime("starts_at").notNull(),
    expiresAt: datetime("expires_at").notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["active", "grace", "expired"],
    })
      .notNull()
      .default("active"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("subscriptions_tenant_id_idx").on(table.tenantId)],
);

export const payments = mysqlTable(
  "payments",
  {
    id: char("id", { length: 26 }).primaryKey(),
    subscriptionId: char("subscription_id", { length: 26 }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    method: varchar("method", {
      length: 20,
      enum: ["transfer", "cash", "other"],
    }).notNull(),
    reference: varchar("reference", { length: 200 }),
    recordedBy: char("recorded_by", { length: 26 }).notNull(),
    notes: text("notes"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("payments_subscription_id_idx").on(table.subscriptionId)],
);
