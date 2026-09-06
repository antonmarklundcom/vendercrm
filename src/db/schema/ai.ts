import { mysqlTable, char, varchar, int, datetime, index, text } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// AI auto-reply audit + metering (PLAN.md §10 1O). Every generated reply
// lands here whether it was drafted, sent, discarded or rejected by a guard
// — the row is the audit trail ("every AI message stored with its prompt and
// model") and the cost meter ("store token counts, expose a monthly total")
// at once. It is deliberately separate from `messages`: most rows never
// become a WhatsApp message at all, and the ones that do point at it via
// message_id.

export const aiReplies = mysqlTable(
  "ai_replies",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    /**
     * Which surface the reply belongs to (docs/SPEC-CHAT-WIDGET.md §1.3).
     * Generalised rather than given a second table so the **per-tenant daily
     * spend cap stays one number**: cost is per-token and per-tenant, and two
     * independent counters would silently double a tenant's ceiling the day
     * the widget shipped. Defaulted to 'whatsapp', so every row written
     * before this column existed keeps its meaning.
     */
    channel: varchar("channel", { length: 10, enum: ["whatsapp", "chat"] })
      .notNull()
      .default("whatsapp"),
    /**
     * What the call was for (PLAN.md §16.2 rule 6). A generated customer
     * reply is `reply`; the memory extractor, the setup-plan generator and
     * the voice-note transcriber (§15.10 W1) write their own kinds so the
     * ledger explains a token bill that has no conversation attached to it.
     * Defaulted, so every row written before the memory existed keeps its
     * meaning.
     */
    kind: varchar("kind", {
      length: 20,
      enum: ["reply", "memory_extract", "setup_plan", "transcription"],
    })
      .notNull()
      .default("reply"),
    /** WhatsApp conversation. Null on the chat channel. */
    conversationId: char("conversation_id", { length: 26 }),
    /** Website chat conversation. Null on the whatsapp channel. */
    chatConversationId: char("chat_conversation_id", { length: 26 }),
    /** Null until a website visitor gives a phone and becomes a contact. */
    contactId: char("contact_id", { length: 26 }),
    /** Set once the draft is approved/sent — the `messages` row it produced. */
    messageId: char("message_id", { length: 26 }),
    /** Which automation run and node produced it, when it came from a flow. */
    flowRunId: char("flow_run_id", { length: 26 }),
    nodeId: varchar("node_id", { length: 100 }),
    /** What the node was configured to do, before any guard downgraded it. */
    mode: varchar("mode", { length: 10, enum: ["draft", "send"] })
      .notNull()
      .default("draft"),
    status: varchar("status", {
      length: 20,
      // draft   — waiting for a rep to approve it in the inbox
      // sent    — delivered (autonomous mode, or an approved draft)
      // discarded — a rep rejected it
      // failed  — the provider call or the send itself errored
      enum: ["draft", "sent", "discarded", "failed"],
    })
      .notNull()
      .default("draft"),
    /** Full prompt as sent to the provider — the audit half of the row. */
    prompt: text("prompt").notNull(),
    body: text("body"),
    provider: varchar("provider", { length: 20 }),
    model: varchar("model", { length: 100 }),
    promptTokens: int("prompt_tokens").notNull().default(0),
    completionTokens: int("completion_tokens").notNull().default(0),
    approvedByUserId: char("approved_by_user_id", { length: 26 }),
    sentAt: datetime("sent_at"),
    error: varchar("error", { length: 2000 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("ai_replies_tenant_id_idx").on(table.tenantId),
    // Pending drafts in the inbox, and the per-conversation daily cap, both
    // read by (tenant, conversation, created_at).
    index("ai_replies_tenant_conversation_idx").on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
    ),
    // The monthly token total in settings, and the per-tenant daily cap.
    index("ai_replies_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("ai_replies_tenant_status_idx").on(table.tenantId, table.status),
    // The chat channel's per-conversation daily cap, and its inbox drafts.
    index("ai_replies_tenant_chat_conversation_idx").on(
      table.tenantId,
      table.chatConversationId,
      table.createdAt,
    ),
  ],
);
