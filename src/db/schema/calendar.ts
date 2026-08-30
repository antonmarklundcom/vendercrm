import {
  mysqlTable,
  char,
  varchar,
  boolean,
  datetime,
  index,
  uniqueIndex,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// The agenda (PLAN.md §10 — the calendar module). A scheduled thing with a
// start and an end: a visit to a site, a call at four, a signing. Tenant-owned
// and shared with the whole business, like the pipeline it hangs off.
//
// Times are stored UTC (§2.3) and rendered in the tenant's own timezone. Every
// grid boundary in modules/calendar is derived from `tenants.timezone`, never
// from the server's clock — a Hostinger box in another zone must not shift
// which day a nine-o'clock visit falls on.
export const calendarEvents = mysqlTable(
  "calendar_events",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    startsAt: datetime("starts_at").notNull(),
    endsAt: datetime("ends_at").notNull(),
    /** Spans whole local days; `starts_at`/`ends_at` still hold the real
     * instants (local midnight to the next local midnight) so one range
     * query finds timed and all-day events alike. */
    allDay: boolean("all_day").notNull().default(false),
    location: varchar("location", { length: 300 }),
    /** What the appointment is about, when it is about something in the CRM. */
    contactId: char("contact_id", { length: 26 }),
    dealId: char("deal_id", { length: 26 }),
    /** Whose agenda it sits on. Null means the business's, not nobody's. */
    assignedUserId: char("assigned_user_id", { length: 26 }),
    createdByUserId: char("created_by_user_id", { length: 26 }).notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // Every calendar read is "this business, this window", which is what
    // this index answers; the others serve the per-rep filter and the
    // contact record's own agenda tab.
    index("calendar_events_tenant_starts_idx").on(table.tenantId, table.startsAt),
    index("calendar_events_tenant_assigned_idx").on(table.tenantId, table.assignedUserId),
    index("calendar_events_tenant_contact_idx").on(table.tenantId, table.contactId),
  ],
);

/**
 * A staff member's Google Calendar, connected for **busy-read only** (B4):
 * the slot generator asks Google "when is this person already busy?" and
 * merges the answer into the busy list it already builds from bookings and
 * calendar events. Nothing is written back to Google in this build.
 *
 * Tokens are encrypted at rest with the same AES-GCM helpers and the same
 * three-column layout `wa_accounts` uses (src/lib/crypto) — a refresh token
 * is a long-lived credential to somebody's personal calendar, so it never
 * sits in plaintext next to the row that says whose calendar it is.
 */
export const gcalConnections = mysqlTable(
  "gcal_connections",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    /** Whose calendar. One connection per user per tenant. */
    userId: char("user_id", { length: 26 }).notNull(),
    googleAccountEmail: varchar("google_account_email", { length: 320 }),
    /** Usually "primary"; stored so a shared calendar can be chosen later. */
    calendarId: varchar("calendar_id", { length: 320 }).notNull().default("primary"),

    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    accessTokenIv: varchar("access_token_iv", { length: 64 }).notNull(),
    accessTokenTag: varchar("access_token_tag", { length: 64 }).notNull(),
    accessTokenExpiresAt: datetime("access_token_expires_at"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    refreshTokenIv: varchar("refresh_token_iv", { length: 64 }),
    refreshTokenTag: varchar("refresh_token_tag", { length: 64 }),

    status: varchar("status", {
      length: 12,
      enum: ["connected", "error", "revoked"],
    })
      .notNull()
      .default("connected"),
    lastError: varchar("last_error", { length: 500 }),
    lastBusyReadAt: datetime("last_busy_read_at"),

    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("gcal_connections_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);
