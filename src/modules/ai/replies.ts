import { and, eq, gte } from "drizzle-orm";
import { aiReplies, conversations } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Storage + read paths for AI-drafted replies (PLAN.md §10 1O). Generation
// and the guards live in ./reply.ts; this file is the persistence half —
// including the two counters the daily caps are enforced against and the
// monthly token total settings shows.

export type AiReplyRow = typeof aiReplies.$inferSelect;

export type RecordReplyInput = {
  /** Which surface (docs/SPEC-CHAT-WIDGET.md §1.3). Absent means whatsapp,
   * so every existing call site keeps its meaning. */
  channel?: "whatsapp" | "chat";
  /** WhatsApp conversation; null on the chat channel. */
  conversationId?: string;
  /** Website chat conversation; null on the whatsapp channel. */
  chatConversationId?: string;
  /** Null until a website visitor gives a phone and becomes a contact. */
  contactId?: string;
  /** What the call was for; absent means a customer reply (PLAN.md §16.2 rule 6). */
  kind?: "reply" | "memory_extract" | "setup_plan" | "weekly_briefing";
  mode: "draft" | "send";
  status: "draft" | "sent" | "failed";
  prompt: string;
  body?: string | null;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  flowRunId?: string;
  nodeId?: string;
  messageId?: string;
  error?: string;
};

export async function recordReply(ctx: TenantContext, input: RecordReplyInput) {
  const id = newId();
  await tenantDb(ctx)
    .insert(aiReplies)
    .values({
      id,
      channel: input.channel ?? "whatsapp",
      kind: input.kind ?? "reply",
      conversationId: input.conversationId ?? null,
      chatConversationId: input.chatConversationId ?? null,
      contactId: input.contactId ?? null,
      mode: input.mode,
      status: input.status,
      // The full prompt is the audit record; truncated only against the
      // column's practical limit, never dropped.
      prompt: input.prompt.slice(0, 60_000),
      body: input.body ?? null,
      provider: input.provider,
      model: input.model,
      promptTokens: input.promptTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      flowRunId: input.flowRunId,
      nodeId: input.nodeId,
      messageId: input.messageId,
      sentAt: input.status === "sent" ? new Date() : null,
      error: input.error?.slice(0, 2000),
    });
  return getReply(ctx, id);
}

export async function getReply(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(aiReplies, eq(aiReplies.id, id));
  return row ?? null;
}

/** Drafts awaiting a rep's approval in one conversation, oldest first. */
export async function listPendingDrafts(ctx: TenantContext, conversationId: string) {
  const rows = await tenantDb(ctx).select(
    aiReplies,
    and(eq(aiReplies.conversationId, conversationId), eq(aiReplies.status, "draft")),
  );
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function listRepliesForConversation(ctx: TenantContext, conversationId: string) {
  const rows = await tenantDb(ctx).select(
    aiReplies,
    eq(aiReplies.conversationId, conversationId),
  );
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function startOfDay(now: Date = new Date()): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day;
}

/**
 * Rows created today for one conversation. Every provider call writes a row
 * — including failures — so this counts *attempts*, which is what a cost cap
 * has to bound. Guard-rejected generations never reach the provider and
 * never write a row, so they correctly don't consume the allowance.
 */
export async function countRepliesTodayForConversation(
  ctx: TenantContext,
  conversationId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await tenantDb(ctx).select(
    aiReplies,
    and(
      eq(aiReplies.conversationId, conversationId),
      gte(aiReplies.createdAt, startOfDay(now)),
    ),
  );
  return rows.length;
}

/**
 * Rows created today for one website chat conversation. The chat channel's
 * half of the per-conversation cap; the per-*tenant* cap needs no channel
 * variant at all, because countRepliesTodayForTenant already counts every
 * row the tenant has — which is exactly why the channel lives on this table
 * rather than in a second one (docs/SPEC-CHAT-WIDGET.md §1.3).
 */
export async function countRepliesTodayForChatConversation(
  ctx: TenantContext,
  chatConversationId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await tenantDb(ctx).select(
    aiReplies,
    and(
      eq(aiReplies.chatConversationId, chatConversationId),
      gte(aiReplies.createdAt, startOfDay(now)),
    ),
  );
  return rows.length;
}

export async function countRepliesTodayForTenant(
  ctx: TenantContext,
  now: Date = new Date(),
): Promise<number> {
  const rows = await tenantDb(ctx).select(aiReplies, gte(aiReplies.createdAt, startOfDay(now)));
  return rows.length;
}

/**
 * The same count, narrowed to one surface.
 *
 * The tenant's daily budget stays one shared number — that is the whole
 * reason `ai_replies` carries a channel instead of the widget getting its
 * own table (docs/SPEC-CHAT-WIDGET.md §1.3). This is a *sub*-cap on top of
 * it: the public, unauthenticated channel must not be able to eat the
 * allowance WhatsApp needs to answer customers who are already talking to
 * the business.
 */
export async function countRepliesTodayForChannel(
  ctx: TenantContext,
  channel: "whatsapp" | "chat",
  now: Date = new Date(),
): Promise<number> {
  const rows = await tenantDb(ctx).select(
    aiReplies,
    and(eq(aiReplies.channel, channel), gte(aiReplies.createdAt, startOfDay(now))),
  );
  return rows.length;
}

/**
 * Whether a provider call has *ever* been made for this website conversation.
 *
 * Not a daily count: it decides whether the visitor still owes a Turnstile
 * verification (§1.2). Every provider call writes a row before the request
 * goes out, so "no rows" means no call has been made — including one a guard
 * refused, which correctly leaves the challenge still owed.
 */
export async function hasRepliesForChatConversation(
  ctx: TenantContext,
  chatConversationId: string,
): Promise<boolean> {
  const rows = await tenantDb(ctx)
    .select(aiReplies, eq(aiReplies.chatConversationId, chatConversationId))
    .limit(1);
  return rows.length > 0;
}

export type TokenUsage = { promptTokens: number; completionTokens: number; replies: number };

/** Monthly token total for the settings meter (§10 1O "expose a monthly total"). */
export async function monthlyTokenUsage(
  ctx: TenantContext,
  now: Date = new Date(),
): Promise<TokenUsage> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await tenantDb(ctx).select(aiReplies, gte(aiReplies.createdAt, monthStart));

  return rows.reduce<TokenUsage>(
    (total, row) => ({
      promptTokens: total.promptTokens + row.promptTokens,
      completionTokens: total.completionTokens + row.completionTokens,
      replies: total.replies + 1,
    }),
    { promptTokens: 0, completionTokens: 0, replies: 0 },
  );
}

export async function markReplySent(
  ctx: TenantContext,
  id: string,
  messageId: string,
  approvedByUserId?: string,
) {
  await tenantDb(ctx)
    .update(aiReplies)
    .set({ status: "sent", messageId, sentAt: new Date(), approvedByUserId })
    .where(eq(aiReplies.id, id));
}

export async function markReplyDiscarded(ctx: TenantContext, id: string, userId?: string) {
  await tenantDb(ctx)
    .update(aiReplies)
    .set({ status: "discarded", approvedByUserId: userId })
    .where(eq(aiReplies.id, id));
}

export async function markReplyFailed(ctx: TenantContext, id: string, error: string) {
  await tenantDb(ctx)
    .update(aiReplies)
    .set({ status: "failed", error: error.slice(0, 2000) })
    .where(eq(aiReplies.id, id));
}

// --- Per-conversation kill switch (§10 1O) -------------------------------

export async function setConversationAiEnabled(
  ctx: TenantContext,
  conversationId: string,
  enabled: boolean,
) {
  await tenantDb(ctx)
    .update(conversations)
    .set({ aiDisabledAt: enabled ? null : new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function isConversationAiDisabled(
  ctx: TenantContext,
  conversationId: string,
): Promise<boolean> {
  const [row] = await tenantDb(ctx).select(conversations, eq(conversations.id, conversationId));
  return !!row?.aiDisabledAt;
}
