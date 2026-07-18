import {
  mysqlTable,
  char,
  varchar,
  json,
  datetime,
  bigint,
  int,
  boolean,
  mysqlEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { generateId } from "@/lib/ids";

export const tenantStatusEnum = ["trial", "active", "suspended"] as const;
export type TenantStatus = (typeof tenantStatusEnum)[number];

export const tenants = mysqlTable(
  "tenants",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    status: mysqlEnum("status", tenantStatusEnum).notNull().default("trial"),
    locale: varchar("locale", { length: 10 }).notNull().default("es"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("America/Asuncion"),
    settings: json("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("tenants_slug_idx").on(table.slug)],
);

export const invitationStatusEnum = ["pending", "accepted", "revoked", "expired"] as const;
export type InvitationStatus = (typeof invitationStatusEnum)[number];

export const invitationRoleEnum = ["admin", "agent"] as const;
export type InvitationRole = (typeof invitationRoleEnum)[number];

export const invitations = mysqlTable(
  "invitations",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: mysqlEnum("role", invitationRoleEnum).notNull().default("agent"),
    token: varchar("token", { length: 64 }).notNull(),
    status: mysqlEnum("status", invitationStatusEnum).notNull().default("pending"),
    invitedByUserId: char("invited_by_user_id", { length: 26 }),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("invitations_token_idx").on(table.token),
    index("invitations_tenant_id_idx").on(table.tenantId),
    index("invitations_email_idx").on(table.email),
  ],
);

export const plans = mysqlTable("plans", {
  id: char("id", { length: 26 })
    .primaryKey()
    .$defaultFn(() => generateId()),
  name: varchar("name", { length: 100 }).notNull(),
  durationMonths: int("duration_months").notNull(),
  price: bigint("price", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("PYG"),
  limits: json("limits").$type<Record<string, unknown>>().notNull().default({}),
  features: json("features").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: datetime("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => new Date()),
});

export const subscriptionStatusEnum = ["active", "grace", "expired"] as const;
export type SubscriptionStatus = (typeof subscriptionStatusEnum)[number];

export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: char("plan_id", { length: 26 })
      .notNull()
      .references(() => plans.id),
    startsAt: datetime("starts_at").notNull(),
    expiresAt: datetime("expires_at").notNull(),
    status: mysqlEnum("status", subscriptionStatusEnum).notNull().default("active"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("subscriptions_tenant_id_idx").on(table.tenantId),
    index("subscriptions_expires_at_idx").on(table.expiresAt),
  ],
);

export const paymentMethodEnum = ["transfer", "cash", "other"] as const;
export type PaymentMethod = (typeof paymentMethodEnum)[number];

export const payments = mysqlTable(
  "payments",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    subscriptionId: char("subscription_id", { length: 26 })
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    method: mysqlEnum("method", paymentMethodEnum).notNull().default("transfer"),
    reference: varchar("reference", { length: 255 }),
    recordedByUserId: char("recorded_by_user_id", { length: 26 }).notNull(),
    notes: varchar("notes", { length: 2000 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("payments_subscription_id_idx").on(table.subscriptionId)],
);
