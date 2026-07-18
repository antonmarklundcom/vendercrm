import {
  mysqlTable,
  char,
  varchar,
  text,
  json,
  datetime,
  int,
  mysqlEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { generateId } from "@/lib/ids";
import { tenants } from "./tenancy";
import { contacts } from "./crm";
import { user } from "./auth";

export const waConnectedViaEnum = ["manual", "embedded"] as const;
export type WaConnectedVia = (typeof waConnectedViaEnum)[number];

export const waAccountStatusEnum = ["connected", "disconnected", "error"] as const;
export type WaAccountStatus = (typeof waAccountStatusEnum)[number];

export const waAccounts = mysqlTable(
  "wa_accounts",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    wabaId: varchar("waba_id", { length: 100 }).notNull(),
    phoneNumberId: varchar("phone_number_id", { length: 100 }).notNull(),
    displayNumber: varchar("display_number", { length: 30 }),
    verifiedName: varchar("verified_name", { length: 255 }),
    status: mysqlEnum("status", waAccountStatusEnum).notNull().default("connected"),
    qualityRating: varchar("quality_rating", { length: 20 }),
    // AES-256-GCM ciphertext/iv/tag (see src/lib/crypto.ts) — never the raw token.
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    accessTokenIv: varchar("access_token_iv", { length: 32 }).notNull(),
    accessTokenTag: varchar("access_token_tag", { length: 32 }).notNull(),
    connectedVia: mysqlEnum("connected_via", waConnectedViaEnum).notNull().default("manual"),
    webhookSubscribedAt: datetime("webhook_subscribed_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("wa_accounts_tenant_id_idx").on(table.tenantId),
    uniqueIndex("wa_accounts_phone_number_id_idx").on(table.phoneNumberId),
  ],
);

export const waTemplateStatusEnum = ["approved", "pending", "rejected"] as const;
export type WaTemplateStatus = (typeof waTemplateStatusEnum)[number];

export const waTemplates = mysqlTable(
  "wa_templates",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    waAccountId: char("wa_account_id", { length: 26 })
      .notNull()
      .references(() => waAccounts.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    language: varchar("language", { length: 10 }).notNull(),
    category: varchar("category", { length: 50 }),
    status: mysqlEnum("status", waTemplateStatusEnum).notNull().default("pending"),
    components: json("components").$type<unknown[]>().notNull().default([]),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("wa_templates_tenant_id_idx").on(table.tenantId),
    index("wa_templates_wa_account_id_idx").on(table.waAccountId),
    uniqueIndex("wa_templates_account_name_lang_idx").on(
      table.waAccountId,
      table.name,
      table.language,
    ),
  ],
);

export const conversationStatusEnum = ["open", "closed"] as const;
export type ConversationStatus = (typeof conversationStatusEnum)[number];

export const conversations = mysqlTable(
  "conversations",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    waAccountId: char("wa_account_id", { length: 26 })
      .notNull()
      .references(() => waAccounts.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    assignedUserId: char("assigned_user_id", { length: 26 }).references(() => user.id),
    status: mysqlEnum("status", conversationStatusEnum).notNull().default("open"),
    lastMessageAt: datetime("last_message_at"),
    lastInboundAt: datetime("last_inbound_at"),
    unreadCount: int("unread_count").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("conversations_tenant_id_idx").on(table.tenantId),
    index("conversations_wa_account_id_idx").on(table.waAccountId),
    uniqueIndex("conversations_account_contact_idx").on(table.waAccountId, table.contactId),
    index("conversations_assigned_user_id_idx").on(table.assignedUserId),
  ],
);

export const messageDirectionEnum = ["in", "out"] as const;
export type MessageDirection = (typeof messageDirectionEnum)[number];

export const messageTypeEnum = [
  "text",
  "image",
  "document",
  "audio",
  "video",
  "template",
  "interactive",
  "reaction",
  "unsupported",
] as const;
export type MessageType = (typeof messageTypeEnum)[number];

export const messageStatusEnum = [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
] as const;
export type MessageStatus = (typeof messageStatusEnum)[number];

export const messages = mysqlTable(
  "messages",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: char("conversation_id", { length: 26 })
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: mysqlEnum("direction", messageDirectionEnum).notNull(),
    waMessageId: varchar("wa_message_id", { length: 128 }),
    type: mysqlEnum("type", messageTypeEnum).notNull(),
    body: text("body"),
    mediaStorageKey: varchar("media_storage_key", { length: 500 }),
    mediaMimeType: varchar("media_mime_type", { length: 100 }),
    templateName: varchar("template_name", { length: 255 }),
    status: mysqlEnum("status", messageStatusEnum).notNull().default("queued"),
    error: json("error").$type<Record<string, unknown>>(),
    sentByUserId: char("sent_by_user_id", { length: 26 }).references(() => user.id),
    automationRunId: char("automation_run_id", { length: 26 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("messages_tenant_id_idx").on(table.tenantId),
    index("messages_conversation_id_idx").on(table.conversationId),
    // Idempotency guard: Meta redelivers webhooks, duplicates must be no-ops.
    uniqueIndex("messages_wa_message_id_idx").on(table.waMessageId),
  ],
);

export const webhookEventStatusEnum = ["received", "processed", "failed"] as const;
export type WebhookEventStatus = (typeof webhookEventStatusEnum)[number];

// Platform-level (no tenant_id) — routing by phone_number_id happens during
// processing, and unroutable payloads (unknown number, malformed body) must
// still be captured for debugging rather than rejected.
export const webhookEvents = mysqlTable(
  "webhook_events",
  {
    id: char("id", { length: 26 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    phoneNumberId: varchar("phone_number_id", { length: 100 }),
    payload: json("payload").$type<unknown>().notNull(),
    status: mysqlEnum("status", webhookEventStatusEnum).notNull().default("received"),
    error: varchar("error", { length: 2000 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("webhook_events_phone_number_id_idx").on(table.phoneNumberId),
    index("webhook_events_status_idx").on(table.status),
    index("webhook_events_created_at_idx").on(table.createdAt),
  ],
);
