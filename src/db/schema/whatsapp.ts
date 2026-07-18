import {
  mysqlTable,
  char,
  varchar,
  int,
  json,
  datetime,
  text,
  index,
  unique,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenancy";
import { contacts } from "./crm";

// WhatsApp integration (PLAN.md §4/§6). wa_accounts/templates/conversations/
// messages are tenant-owned; webhook_events is platform-level (Meta posts all
// tenants' traffic to one endpoint, routed by phone_number_id).

export const waAccounts = mysqlTable(
  "wa_accounts",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    wabaId: varchar("waba_id", { length: 64 }).notNull(),
    // Meta's phone number id — the routing key for inbound webhooks. Unique
    // across the whole platform so a webhook maps to exactly one account.
    phoneNumberId: varchar("phone_number_id", { length: 64 }).notNull(),
    displayNumber: varchar("display_number", { length: 32 }),
    verifiedName: varchar("verified_name", { length: 255 }),
    status: varchar("status", { length: 32 }).notNull().default("connected"),
    qualityRating: varchar("quality_rating", { length: 16 }),
    // System-user access token, AES-256-GCM encrypted at rest (lib/crypto,
    // PLAN.md §3.4). Stored as ciphertext/iv/tag; never logged or sent to the
    // client.
    accessTokenCiphertext: text("access_token_ciphertext"),
    accessTokenIv: varchar("access_token_iv", { length: 32 }),
    accessTokenTag: varchar("access_token_tag", { length: 32 }),
    connectedVia: varchar("connected_via", {
      length: 16,
      enum: ["embedded", "manual"],
    })
      .notNull()
      .default("manual"),
    webhookSubscribedAt: datetime("webhook_subscribed_at"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("wa_accounts_tenant_idx").on(t.tenantId),
    unique("wa_accounts_phone_number_id_uq").on(t.phoneNumberId),
  ],
);

export const waTemplates = mysqlTable(
  "wa_templates",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    waAccountId: char("wa_account_id", { length: 26 })
      .notNull()
      .references(() => waAccounts.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    language: varchar("language", { length: 16 }).notNull(),
    category: varchar("category", { length: 32 }),
    status: varchar("status", { length: 32 }).notNull(),
    components: json("components"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("wa_templates_tenant_idx").on(t.tenantId),
    unique("wa_templates_account_name_lang_uq").on(
      t.waAccountId,
      t.name,
      t.language,
    ),
  ],
);

export const conversations = mysqlTable(
  "conversations",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    waAccountId: char("wa_account_id", { length: 26 })
      .notNull()
      .references(() => waAccounts.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    assignedUserId: char("assigned_user_id", { length: 26 }),
    status: varchar("status", { length: 16, enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    lastMessageAt: datetime("last_message_at"),
    // Drives the 24h free-form window (PLAN.md §6.4).
    lastInboundAt: datetime("last_inbound_at"),
    unreadCount: int("unread_count").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("conversations_tenant_idx").on(t.tenantId),
    // One conversation per contact per account.
    unique("conversations_account_contact_uq").on(t.waAccountId, t.contactId),
  ],
);

export const messages = mysqlTable(
  "messages",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: char("conversation_id", { length: 26 })
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: varchar("direction", { length: 4, enum: ["in", "out"] }).notNull(),
    // Meta's message id. Unique → the idempotency guard: Meta redelivers, so a
    // duplicate insert is a no-op (PLAN.md §6.3). Nullable for queued outbound
    // messages that don't have an id until Meta accepts them.
    waMessageId: varchar("wa_message_id", { length: 128 }),
    type: varchar("type", { length: 24 }).notNull().default("text"),
    body: text("body"),
    mediaId: varchar("media_id", { length: 128 }),
    storageKey: varchar("storage_key", { length: 255 }),
    status: varchar("status", {
      length: 16,
      enum: ["queued", "sent", "delivered", "read", "failed"],
    }).notNull(),
    error: json("error"),
    sentByUserId: char("sent_by_user_id", { length: 26 }),
    // Set when an automation sent the message (1F). Nullable column now; the
    // FK to flow_runs is added when that table lands.
    automationRunId: char("automation_run_id", { length: 26 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("messages_tenant_idx").on(t.tenantId),
    index("messages_conversation_idx").on(t.conversationId),
    unique("messages_wa_message_id_uq").on(t.waMessageId),
  ],
);

// Platform-level raw webhook log for replay/debugging; pruned after 30 days
// (PLAN.md §6.3, §1G).
export const webhookEvents = mysqlTable(
  "webhook_events",
  {
    id: char("id", { length: 26 }).primaryKey(),
    phoneNumberId: varchar("phone_number_id", { length: 64 }),
    payload: json("payload").notNull(),
    status: varchar("status", {
      length: 16,
      enum: ["received", "processed", "failed"],
    })
      .notNull()
      .default("received"),
    error: text("error"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("webhook_events_phone_idx").on(t.phoneNumberId),
    index("webhook_events_status_idx").on(t.status),
  ],
);
