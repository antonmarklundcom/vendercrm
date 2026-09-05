import {
  mysqlTable,
  char,
  varchar,
  datetime,
  index,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// In-app notifications (PLAN.md §15.5 J1 `notify_user`, §15.8 P1).
//
// A row per thing a specific user should look at: an automation that wants a
// human, a task coming due, a lead that landed on their name. P2 delivers
// these by web push; until then the bell in the nav is the whole delivery
// mechanism, which is why the row — not the push — is the source of truth.
// A push that never arrives (permission denied, no subscription, an iPhone)
// must not mean the user never hears about it.

export const notifications = mysqlTable(
  "notifications",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    /** Who should see it. Notifications are per-user, never per-tenant broadcast. */
    userId: char("user_id", { length: 26 }).notNull(),
    /**
     * What produced it, for grouping and for P2's push payload. A varchar
     * with a drizzle-level enum: widening it is a type change with no
     * migration, the same choice `flows.trigger_type` made.
     */
    kind: varchar("kind", {
      length: 40,
      enum: ["automation", "task_due", "assignment", "inbound_message", "system"],
    })
      .notNull()
      .default("system"),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),
    /** Where clicking it should land — an app-relative path. */
    url: varchar("url", { length: 500 }),
    /** Null until the user has seen it; the bell's unread count is this column. */
    readAt: datetime("read_at"),
    /** The automation run that wrote it, when one did. */
    flowRunId: char("flow_run_id", { length: 26 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // The bell reads (tenant, user, unread) and then orders by recency —
    // both the list and the count come off this one index.
    index("notifications_tenant_user_read_idx").on(table.tenantId, table.userId, table.readAt),
    index("notifications_tenant_user_created_idx").on(
      table.tenantId,
      table.userId,
      table.createdAt,
    ),
  ],
);
