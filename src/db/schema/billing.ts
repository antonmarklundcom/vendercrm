import {
  mysqlTable,
  char,
  varchar,
  bigint,
  boolean,
  json,
  datetime,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenancy";

// Platform-level billing (PLAN.md §1.2, §4). Prepay-only: quarterly / 6-month /
// 12-month plans. Phase 1 collection is manual — a superadmin records payments
// and sets subscription expiry; no payment gateway.

export const plans = mysqlTable("plans", {
  id: char("id", { length: 26 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  durationMonths: bigint("duration_months", { mode: "number" }).notNull(),
  // Money as integer minor units + currency (PYG has 0 decimals) — PLAN.md §2.3.
  price: bigint("price", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("PYG"),
  limits: json("limits"),
  features: json("features"),
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
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: char("plan_id", { length: 26 })
      .notNull()
      .references(() => plans.id),
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
    subscriptionId: char("subscription_id", { length: 26 })
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    method: varchar("method", {
      length: 20,
      enum: ["transfer", "cash", "other"],
    }).notNull(),
    reference: varchar("reference", { length: 255 }),
    recordedByUserId: char("recorded_by_user_id", { length: 26 }).notNull(),
    notes: varchar("notes", { length: 1000 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("payments_subscription_id_idx").on(table.subscriptionId)],
);
