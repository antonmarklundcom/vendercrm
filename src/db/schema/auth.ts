import {
  mysqlTable,
  char,
  varchar,
  text,
  boolean,
  datetime,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Better Auth core + admin-plugin tables, hand-written in Drizzle so PKs are
// our char(26) ULIDs and columns get MySQL-appropriate types (PLAN.md §2.3).
// Table/column names match Better Auth's default model + field names so the
// drizzle adapter maps them without extra config. See lib/auth.ts for the
// role reconciliation (admin-plugin `role` = platform role superadmin|user;
// `tenant_role` = the §3.2 tenant role admin|agent).

export const user = mysqlTable(
  "user",
  {
    id: char("id", { length: 26 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),

    // Domain fields (Better Auth `additionalFields`, PLAN.md §4).
    tenantId: char("tenant_id", { length: 26 }),
    tenantRole: varchar("tenant_role", { length: 10, enum: ["admin", "agent"] }),

    // Admin-plugin fields. `role` is the platform authorization role
    // (superadmin|user) that gates impersonation via adminRoles.
    role: varchar("role", { length: 20 }).default("user"),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: datetime("ban_expires"),

    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("user_tenant_id_idx").on(table.tenantId)],
);

export const session = mysqlTable(
  "session",
  {
    id: char("id", { length: 26 }).primaryKey(),
    userId: char("user_id", { length: 26 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 255 }).notNull().unique(),
    expiresAt: datetime("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    // Admin-plugin field: set on the impersonation session to the real
    // superadmin's user id (PLAN.md §3.2 — audited with both users).
    impersonatedBy: char("impersonated_by", { length: 26 }),

    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = mysqlTable(
  "account",
  {
    id: char("id", { length: 26 }).primaryKey(),
    userId: char("user_id", { length: 26 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 255 }).notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: datetime("access_token_expires_at"),
    refreshTokenExpiresAt: datetime("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = mysqlTable(
  "verification",
  {
    id: char("id", { length: 26 }).primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: text("value").notNull(),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
