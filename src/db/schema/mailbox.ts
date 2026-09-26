import {
  mysqlTable,
  char,
  varchar,
  boolean,
  json,
  datetime,
  index,
  uniqueIndex,
  text,
  mediumtext,
  int,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Per-domain mailboxes (PLAN-EMAIL.md E2/E3). Inbound mail arrives from the
// Cloudflare Worker in workers/email-inbound, is routed to a tenant by the
// recipient address, and lands here. Every table carries `tenant_id` and is
// read and written only through tenantDb — the one exception is the routing
// lookup in modules/mailbox/routing.ts, which has to find *which* tenant owns
// an address before any TenantContext exists (same shape as the WhatsApp
// phone_number_id and site API key lookups).
//
// Own tables rather than WhatsApp's `conversations`/`messages`, for the same
// reason chat_* has its own: an email sender has no phone number, and
// `contacts.phone` is NOT NULL — a thread links to a contact when one with
// that email exists, and stays unlinked otherwise rather than inventing one.

/**
 * An address the platform receives mail for. `address` is unique across the
 * whole platform because it is the routing key. `isCatchAll` makes this
 * mailbox also receive mail for any other local part at its domain (the
 * Cloudflare catch-all rule forwards everything to the Worker).
 */
export const mailboxes = mysqlTable(
  "mailboxes",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    address: varchar("address", { length: 320 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 200 }),
    isCatchAll: boolean("is_catch_all").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("mailboxes_address_idx").on(table.address),
    index("mailboxes_tenant_id_idx").on(table.tenantId),
    index("mailboxes_domain_idx").on(table.domain),
  ],
);

/**
 * One conversation with one outside person. `participantEmail` is that
 * person's address — the fallback threading key together with the
 * normalized subject (modules/mailbox/threading.ts).
 */
export const emailThreads = mysqlTable(
  "email_threads",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    mailboxId: char("mailbox_id", { length: 26 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull().default(""),
    normalizedSubject: varchar("normalized_subject", { length: 500 }).notNull().default(""),
    participantEmail: varchar("participant_email", { length: 320 }).notNull(),
    participantName: varchar("participant_name", { length: 200 }),
    contactId: char("contact_id", { length: 26 }),
    dealId: char("deal_id", { length: 26 }),
    status: varchar("status", { length: 10, enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    unread: boolean("unread").notNull().default(true),
    lastMessageAt: datetime("last_message_at").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("email_threads_tenant_last_idx").on(table.tenantId, table.lastMessageAt),
    index("email_threads_tenant_mailbox_idx").on(table.tenantId, table.mailboxId),
    index("email_threads_tenant_participant_idx").on(table.tenantId, table.participantEmail),
    index("email_threads_tenant_contact_idx").on(table.tenantId, table.contactId),
  ],
);

/**
 * One email, either direction. `messageId` is the RFC 5322 Message-ID (angle
 * brackets stripped) and is unique per tenant — the inbound webhook's
 * idempotency key, and what `In-Reply-To`/`References` are matched against.
 */
export const emailMessages = mysqlTable(
  "email_messages",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    threadId: char("thread_id", { length: 26 }).notNull(),
    mailboxId: char("mailbox_id", { length: 26 }).notNull(),
    direction: varchar("direction", { length: 3, enum: ["in", "out"] }).notNull(),
    messageId: varchar("message_id", { length: 500 }).notNull(),
    inReplyTo: varchar("in_reply_to", { length: 500 }),
    references: text("references"),
    fromAddress: varchar("from_address", { length: 320 }).notNull(),
    fromName: varchar("from_name", { length: 200 }),
    /** Reply-To, when the sender set one — where a reply to this goes. */
    replyTo: varchar("reply_to", { length: 320 }),
    /** `[{ address, name? }]` */
    to: json("to").notNull().default([]),
    cc: json("cc").notNull().default([]),
    subject: varchar("subject", { length: 500 }).notNull().default(""),
    textBody: mediumtext("text_body"),
    /** Already sanitized (modules/mailbox/sanitize.ts); never raw HTML. */
    htmlBody: mediumtext("html_body"),
    /** Storage key of the original .eml, inbound only. */
    rawKey: varchar("raw_key", { length: 500 }),
    status: varchar("status", {
      length: 10,
      enum: ["received", "queued", "sent", "failed", "bounced"],
    }).notNull(),
    sentByUserId: char("sent_by_user_id", { length: 26 }),
    /** Date header for inbound, send time for outbound. */
    sentAt: datetime("sent_at").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("email_messages_tenant_message_id_idx").on(table.tenantId, table.messageId),
    index("email_messages_tenant_thread_idx").on(table.tenantId, table.threadId),
    index("email_messages_tenant_mailbox_dir_idx").on(
      table.tenantId,
      table.mailboxId,
      table.direction,
      table.createdAt,
    ),
  ],
);

export const emailAttachments = mysqlTable(
  "email_attachments",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    /** email_messages.id (ours, not the Message-ID header). */
    emailMessageId: char("email_message_id", { length: 26 }).notNull(),
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 150 }).notNull(),
    size: int("size").notNull(),
    /** Content-ID for inline images referenced as cid: in the HTML body. */
    contentId: varchar("content_id", { length: 255 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("email_attachments_tenant_message_idx").on(table.tenantId, table.emailMessageId),
  ],
);
