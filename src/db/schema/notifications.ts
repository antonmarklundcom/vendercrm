import {
  mysqlTable,
  char,
  varchar,
  datetime,
  index,
  uniqueIndex,
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

// Web push subscriptions (PLAN.md §15.5 J2, §15.8 P2).
//
// One row per *browser*, not per user: the same person installs the PWA on a
// phone and opens the app on a laptop, and both should buzz. The endpoint the
// push service hands out is the identity of that browser, which is why it —
// not (tenant, user) — carries the unique index: re-subscribing the same
// browser must update the row rather than accumulate a second one that will
// deliver a duplicate of every notification.
//
// The row is disposable. `web-push` answering 404 or 410 means the browser
// revoked or expired this endpoint, and the only correct response is to
// delete it (modules/notifications/subscriptions.ts). Nothing else in the
// product refers to a subscription, so a delete loses nothing: the
// `notifications` row it would have delivered is still in the bell.
export const pushSubscriptions = mysqlTable(
  "push_subscriptions",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    /** Whose browser this is. A push carries one person's work, never the
     * tenant's — same rule as `notifications.user_id`. */
    userId: char("user_id", { length: 26 }).notNull(),
    /**
     * The push service URL to POST to. Unique across the platform: a browser
     * has exactly one endpoint per registration, and the same browser cannot
     * belong to two people at once — signing in as somebody else re-subscribes
     * and this row moves with it.
     *
     * 500 is comfortably above what the services in use actually issue (FCM's
     * are ~200 characters, Mozilla's ~110) and stays inside InnoDB's 3072-byte
     * index key limit at utf8mb4.
     */
    endpoint: varchar("endpoint", { length: 500 }).notNull(),
    /** The subscription's public key and auth secret, from `PushSubscription
     * .getKey()`. Base64url, opaque to us — `web-push` does the encryption. */
    p256dh: varchar("p256dh", { length: 255 }).notNull(),
    auth: varchar("auth", { length: 255 }).notNull(),
    /** Only so a person can recognise their own devices in settings. */
    userAgent: varchar("user_agent", { length: 255 }),
    /** Refreshed every time the browser re-registers, so a stale row is
     * visible as stale even before a push fails against it. */
    lastSeenAt: datetime("last_seen_at"),
    /**
     * When a send last failed for a reason that was *not* 404/410 — a push
     * service outage, a malformed payload. Kept rather than deleted: the
     * endpoint may well work on the next notification, and a column that
     * fills up across every row is how an outage becomes visible.
     */
    failedAt: datetime("failed_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
    // The fan-out reads (tenant, user) and nothing else.
    index("push_subscriptions_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);
