import { relations, sql } from "drizzle-orm";
import {
  mysqlTable,
  char,
  varchar,
  text,
  datetime,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { generateId } from "@/lib/ids";
import { tenants } from "./tenancy";

// Better Auth core tables. Field names (JS keys) must match Better Auth's
// expected model field keys exactly; only column names/types/ids are
// adapted to this project's conventions (snake_case columns, ulid ids).

export const user = mysqlTable(
  "user",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // Domain role: "superadmin" (platform, tenantId null) | "admin" | "agent" (tenant-scoped).
    role: varchar("role", { length: 32 }),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: datetime("ban_expires"),
    tenantId: char("tenant_id", { length: 26 }).references(() => tenants.id),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("user_email_idx").on(table.email),
    index("user_tenant_id_idx").on(table.tenantId),
  ],
);

export const session = mysqlTable(
  "session",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    expiresAt: datetime("expires_at").notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: char("user_id", { length: 26 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: char("impersonated_by", { length: 26 }),
  },
  (table) => [
    uniqueIndex("session_token_idx").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = mysqlTable(
  "account",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: char("user_id", { length: 26 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
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
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = mysqlTable(
  "verification",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: text("value").notNull(),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
