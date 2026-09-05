import { buildSystemPrompt, getAiDriver, type AiTurn } from "@/lib/ai";
import type { TenantContext } from "@/modules/tenancy/context";
import { getAiConfig } from "@/modules/ai/config";
import {
  evaluateGuards,
  resolveMode,
  type AiSkipReason,
  type GuardInput,
} from "@/modules/ai/reply";
import {
  countRepliesTodayForChannel,
  countRepliesTodayForChatConversation,
  countRepliesTodayForTenant,
  markReplyFailed,
  recordReply,
} from "@/modules/ai/replies";
import { isWithinBusinessHours } from "@/modules/automations/conditions";
import { buildMemoryContext } from "@/modules/memory/retrieve";
import {
  appendMessage,
  getConversation,
  listMessages,
  setConversationAiDisabled,
} from "./conversations";
import {
  DEFAULT_MAX_REPLIES_PER_CONVERSATION_PER_DAY,
  type ChatWidget,
} from "./widgets";
import { markReplySent, updateReplyUsage } from "./usage";

// The guarded chat reply path (docs/SPEC-CHAT-WIDGET.md §4).
//
// One driver, one guard file, no second abstraction: `lib/ai` is used exactly
// as it is (AI_DRIVER / OPENAI_API_KEY / GEMINI_API_KEY / AI_BASE_URL per
// docs/DEPLOY.md §5), and the two *pure* decisions from modules/ai/reply.ts —
// `evaluateGuards` and `resolveMode` — are imported rather than re-expressed,
// so the guard order and the draft ceiling cannot drift between channels.

export type ChatReplyOutcome =
  | { status: "sent"; replyId: string; body: string }
  | { status: "draft"; replyId: string }
  | { status: "skipped"; reason: ChatSkipReason }
  | { status: "failed"; reason: string };

export type ChatSkipReason =
  | AiSkipReason
  | "widget_off"
  | "outside_business_hours"
  /** Decided in ./public.ts, before this file is reached: the first provider
   * call of a conversation needs a Turnstile token and did not get a valid
   * one. The message is captured either way. */
  | "turnstile_unverified";

/**
 * Chat's share of the tenant's daily AI budget.
 *
 * The ceiling stays shared — one tenant, one bill (§1.3). This bounds
 * something the shared ceiling cannot: *which* channel spends it. Chat is
 * the public, unauthenticated surface, reachable by anyone who can load the
 * tenant's website, so left alone it can burn the whole allowance before a
 * customer already mid-conversation on WhatsApp gets an answer. Half is the
 * split, floored — never to zero, because a tenant whose entire budget is a
 * single call should still be able to answer one visitor.
 */
export const CHAT_CHANNEL_BUDGET_SHARE = 0.5;

export function chatChannelCap(maxPerTenantPerDay: number): number {
  return Math.max(1, Math.floor(maxPerTenantPerDay * CHAT_CHANNEL_BUDGET_SHARE));
}

/**
 * The WhatsApp-only guard inputs, pinned to values a website chat cannot
 * violate — pinned *here*, in one place with the reason written down, rather
 * than by deleting them from the shared function.
 */
export function chatGuardInput(input: {
  tenantAiEnabled: boolean;
  driverConfigured: boolean;
  conversationAiDisabled: boolean;
  repliesTodayForConversation: number;
  repliesTodayForTenant: number;
  repliesTodayForChat: number;
  maxPerConversationPerDay: number;
  maxPerTenantPerDay: number;
}): GuardInput {
  const { repliesTodayForChat, ...rest } = input;
  return {
    ...rest,
    // BAJA/STOP is a WhatsApp opt-out and there is usually no contact yet.
    optedOut: false,
    // The 24h window is Meta policy about WhatsApp. It does not exist on a
    // website, and a visitor typing right now is by definition available.
    withinWindow: true,
    repliesTodayForChannel: repliesTodayForChat,
    maxPerChannelPerDay: chatChannelCap(input.maxPerTenantPerDay),
  };
}

export type GenerateChatReplyInput = {
  widget: ChatWidget;
  chatConversationId: string;
  /** What the visitor just said — already persisted by the caller. */
  visitorMessage: string;
};

export async function generateChatReply(
  ctx: TenantContext,
  input: GenerateChatReplyInput,
  now: Date = new Date(),
): Promise<ChatReplyOutcome> {
  const { widget } = input;
  if (!widget.isActive || widget.mode === "off") {
    return { status: "skipped", reason: "widget_off" };
  }

  const conversation = await getConversation(ctx, input.chatConversationId);
  if (!conversation) return { status: "skipped", reason: "no_conversation" };

  if (widget.businessHoursMode === "business_hours") {
    // Refused before a token is spent, not after: outside hours the widget
    // captures and says so, which costs nothing.
    if (!(await isWithinBusinessHours(ctx, now))) {
      return { status: "skipped", reason: "outside_business_hours" };
    }
  }

  const config = await getAiConfig(ctx);
  const driver = getAiDriver();

  const maxPerConversation =
    widget.maxRepliesPerConversationPerDay ?? DEFAULT_MAX_REPLIES_PER_CONVERSATION_PER_DAY;

  const [repliesForConversation, repliesForTenant, repliesForChat] = await Promise.all([
    countRepliesTodayForChatConversation(ctx, conversation.id, now),
    // Not a chat-only count: the tenant's daily budget is shared with
    // WhatsApp, which is the whole reason `ai_replies` carries a channel
    // instead of the widget getting its own table.
    countRepliesTodayForTenant(ctx, now),
    // And the chat channel's own half of it — see chatChannelCap.
    countRepliesTodayForChannel(ctx, "chat", now),
  ]);

  const verdict = evaluateGuards(
    chatGuardInput({
      tenantAiEnabled: config.enabled,
      driverConfigured: driver !== null,
      conversationAiDisabled: conversation.aiDisabledAt !== null,
      repliesTodayForConversation: repliesForConversation,
      repliesTodayForTenant: repliesForTenant,
      repliesTodayForChat: repliesForChat,
      maxPerConversationPerDay: maxPerConversation,
      maxPerTenantPerDay: config.maxRepliesPerTenantPerDay,
    }),
  );
  if (!verdict.allowed) return { status: "skipped", reason: verdict.reason };

  // The tenant mode is a ceiling over the widget mode, exactly as it is over
  // a flow node: a widget cannot send while the tenant is on draft, so going
  // autonomous stays a two-key operation.
  const mode = resolveMode(widget.mode === "send" ? "send" : "draft", config.mode);

  const history = await listMessages(ctx, conversation.id);
  const turns: AiTurn[] = history
    .filter((message) => (message.body ?? "").trim().length > 0)
    .slice(-20)
    .map((message) => ({
      role: message.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: message.body ?? "",
    }));

  // Same memory, same customer audience as WhatsApp (§16.4) — one source, so
  // a visitor on the website and a customer on WhatsApp get the same answer
  // to the same question.
  const memory = await buildMemoryContext(ctx, {
    query: input.visitorMessage,
    audience: "customer",
  });

  const system = buildSystemPrompt({
    ...config.business,
    memory: memory.block,
    // The tenant's own words are *appended* to lib/ai's Spanish guardrail
    // block, never in place of it — a widget prompt cannot switch off "never
    // invent a price".
    instructions: widget.systemPrompt ?? undefined,
    neverPromise: widget.neverPromise || config.business.neverPromise,
  });

  const reply = await recordReply(ctx, {
    channel: "chat",
    chatConversationId: conversation.id,
    contactId: conversation.contactId ?? undefined,
    mode,
    status: "draft",
    prompt: `${system}\n\n---\n${turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n")}`,
  });
  if (!reply) return { status: "failed", reason: "record_failed" };

  let generated;
  try {
    generated = await driver!.generateReply({ system, messages: turns });
  } catch (error) {
    await markReplyFailed(ctx, reply.id, error instanceof Error ? error.message : "unknown");
    return { status: "failed", reason: "provider_error" };
  }

  const body = generated.text.trim();
  await updateReplyUsage(ctx, reply.id, {
    body,
    provider: driver!.provider,
    model: generated.model,
    promptTokens: generated.promptTokens,
    completionTokens: generated.completionTokens,
  });

  if (mode === "draft") {
    // The visitor is told a person is coming, never shown the draft — a draft
    // is for the rep to approve, which is the whole point of draft mode.
    return { status: "draft", replyId: reply.id };
  }

  const message = await appendMessage(
    ctx,
    {
      chatConversationId: conversation.id,
      direction: "out",
      author: "ai",
      body,
      aiReplyId: reply.id,
    },
    now,
  );
  await markReplySent(ctx, reply.id, message?.id);

  return { status: "sent", replyId: reply.id, body };
}

/**
 * The handoff keyword, working the same way it does on WhatsApp and for the
 * same reason (§10 1O): a customer asking for a human must be heard whether
 * or not the tenant configured anything. It silences only the AI — reps keep
 * replying in the same thread.
 */
export async function applyHandoffKeyword(
  ctx: TenantContext,
  chatConversationId: string,
  body: string,
): Promise<boolean> {
  const config = await getAiConfig(ctx);
  if (body.trim().toLowerCase() !== config.handoffKeyword) return false;
  await setConversationAiDisabled(ctx, chatConversationId, true);
  return true;
}
