import {
  mysqlTable,
  char,
  varchar,
  int,
  json,
  datetime,
  index,
  uniqueIndex,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// WhatsApp integration (PLAN.md §4 "whatsapp", §6). access_token is
// encrypted at the application layer (§3.4, lib/crypto) — only ciphertext/
// iv/tag ever land in this column, never a plaintext token.

export const waAccounts = mysqlTable(
  "wa_accounts",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    wabaId: varchar("waba_id", { length: 100 }).notNull(),
    phoneNumberId: varchar("phone_number_id", { length: 100 }).notNull(),
    displayNumber: varchar("display_number", { length: 30 }),
    verifiedName: varchar("verified_name", { length: 200 }),
    status: varchar("status", {
      length: 20,
      enum: ["connected", "disconnected", "error"],
    })
      .notNull()
      .default("connected"),
    qualityRating: varchar("quality_rating", { length: 20 }),
    // AES-256-GCM (lib/crypto) — ciphertext/iv/tag, never plaintext (§3.4).
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    accessTokenIv: varchar("access_token_iv", { length: 64 }).notNull(),
    accessTokenTag: varchar("access_token_tag", { length: 64 }).notNull(),
    connectedVia: varchar("connected_via", {
      length: 20,
      enum: ["embedded", "manual"],
    })
      .notNull()
      .default("manual"),
    webhookSubscribedAt: datetime("webhook_subscribed_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("wa_accounts_tenant_id_idx").on(table.tenantId),
    // Global, not per-tenant: Meta sends all tenants' webhook traffic to one
    // endpoint routed by phone_number_id (§6.3), so it must resolve to
    // exactly one account platform-wide.
    uniqueIndex("wa_accounts_phone_number_id_idx").on(table.phoneNumberId),
  ],
);

export const waTemplates = mysqlTable(
  "wa_templates",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    waAccountId: char("wa_account_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    language: varchar("language", { length: 10 }).notNull(),
    category: varchar("category", { length: 30 }),
    status: varchar("status", {
      length: 20,
      enum: ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"],
    })
      .notNull()
      .default("PENDING"),
    components: json("components").notNull().default([]),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("wa_templates_tenant_id_idx").on(table.tenantId),
    index("wa_templates_account_id_idx").on(table.waAccountId),
  ],
);

export const conversations = mysqlTable(
  "conversations",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    waAccountId: char("wa_account_id", { length: 26 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    assignedUserId: char("assigned_user_id", { length: 26 }),
    status: varchar("status", { length: 20, enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    lastMessageAt: datetime("last_message_at"),
    // Drives the 24h free-form-vs-template send window (§6.4).
    lastInboundAt: datetime("last_inbound_at"),
    unreadCount: int("unread_count").notNull().default(0),
    /**
     * Per-conversation AI kill switch (PLAN.md §10 1O). Non-null means the
     * bot is silenced for this contact — set by a rep from the inbox, or
     * automatically when the contact sends the tenant's handoff keyword.
     * A timestamp rather than a boolean so "when did we hand this off" is
     * answerable without a separate audit read.
     */
    aiDisabledAt: datetime("ai_disabled_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("conversations_tenant_id_idx").on(table.tenantId),
    uniqueIndex("conversations_account_contact_idx").on(table.waAccountId, table.contactId),
    index("conversations_tenant_assigned_idx").on(table.tenantId, table.assignedUserId),
  ],
);

export const messages = mysqlTable(
  "messages",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    conversationId: char("conversation_id", { length: 26 }).notNull(),
    direction: varchar("direction", { length: 3, enum: ["in", "out"] }).notNull(),
    // Meta's own message id — the idempotency guard against webhook
    // redelivery (§6.3). Nullable: an outbound send doesn't have one until
    // the Graph API call succeeds.
    waMessageId: varchar("wa_message_id", { length: 100 }),
    type: varchar("type", {
      length: 20,
      enum: [
        "text",
        "image",
        "document",
        "audio",
        "video",
        "template",
        "interactive",
        "reaction",
        "unsupported",
      ],
    }).notNull(),
    body: text("body"),
    mediaId: varchar("media_id", { length: 200 }),
    storageKey: varchar("storage_key", { length: 500 }),
    status: varchar("status", {
      length: 20,
      enum: ["queued", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("queued"),
    error: json("error"),
    sentByUserId: char("sent_by_user_id", { length: 26 }),
    automationRunId: char("automation_run_id", { length: 26 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("messages_tenant_id_idx").on(table.tenantId),
    index("messages_conversation_id_idx").on(table.conversationId),
    uniqueIndex("messages_wa_message_id_idx").on(table.waMessageId),
  ],
);

// Tenant-level canned responses (PLAN.md §15.5 J2 inbox half, §15.8 P3).
// `{{contacto.nombre}}`-style variables are resolved at send time in
// modules/whatsapp/quick-replies.ts — this table stores the template only.
export const quickReplies = mysqlTable(
  "quick_replies",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    body: text("body").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("quick_replies_tenant_id_idx").on(table.tenantId)],
);

// Internal notes on a conversation (§15.8 P3): rendered inline in the thread
// but never sent — no `messages` row, no `wa_message_id`, invisible to the
// customer. Also surfaced on the contact timeline (modules/crm/timeline.ts).
export const conversationNotes = mysqlTable(
  "conversation_notes",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    conversationId: char("conversation_id", { length: 26 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    authorUserId: char("author_user_id", { length: 26 }).notNull(),
    body: text("body").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("conversation_notes_tenant_id_idx").on(table.tenantId),
    index("conversation_notes_conversation_id_idx").on(table.conversationId),
    index("conversation_notes_contact_id_idx").on(table.contactId),
  ],
);

// Platform-level (no tenant_id) — routing by phone_number_id happens after
// this raw persist, so an unrecognized number still lands here for replay/
// debugging (§6.3 rule 4) rather than being silently dropped.
export const webhookEvents = mysqlTable(
  "webhook_events",
  {
    id: char("id", { length: 26 }).primaryKey(),
    payload: json("payload").notNull(),
    phoneNumberId: varchar("phone_number_id", { length: 100 }),
    status: varchar("status", {
      length: 20,
      enum: ["received", "processed", "failed"],
    })
      .notNull()
      .default("received"),
    error: varchar("error", { length: 2000 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("webhook_events_phone_number_id_idx").on(table.phoneNumberId),
    index("webhook_events_status_idx").on(table.status),
  ],
);
