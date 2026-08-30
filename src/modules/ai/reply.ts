import { eq } from "drizzle-orm";
import { messages } from "@/db/schema";
import { buildReplyPrompt, extractBookingIntent, getAiDriver, serialisePrompt } from "@/lib/ai";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getContact } from "@/modules/crm/contacts";
import { getPrimaryAccount } from "@/modules/whatsapp/accounts";
import {
  getConversation,
  getOrCreateConversation,
  isWithinFreeFormWindow,
  listMessagesForConversation,
} from "@/modules/whatsapp/inbox";
import { sendText } from "@/modules/whatsapp/send";
import { getAiConfig } from "./config";
import {
  countRepliesTodayForConversation,
  countRepliesTodayForTenant,
  getReply,
  markReplyFailed,
  markReplySent,
  recordReply,
} from "./replies";

// The guarded AI reply path (PLAN.md §10 1O). Everything that can generate
// or send an AI message goes through this file, for the same reason every
// outbound WhatsApp message goes through whatsapp/send.ts: the rules have to
// live where they cannot be forgotten by a caller.
//
// The 24h-window rule is the one that is enforced twice on purpose. Here it
// stops generation before a token is spent, and again inside sendText, which
// throws outside the window. An LLM can never author a template — templates
// are pre-approved by Meta — so outside the window there is nothing valid
// for this path to produce, drafts included: a rep could not send that draft
// either.

export type AiReplyOutcome =
  | { status: "sent"; replyId: string; messageId: string }
  | { status: "draft"; replyId: string }
  | { status: "skipped"; reason: AiSkipReason }
  | { status: "failed"; reason: string; replyId?: string };

export type AiSkipReason =
  | "ai_disabled_for_tenant"
  | "ai_not_configured"
  | "no_whatsapp_account"
  | "no_conversation"
  | "conversation_ai_disabled"
  | "contact_opted_out"
  | "window_closed"
  | "conversation_daily_cap"
  | "tenant_daily_cap"
  | "channel_daily_cap"
  | "no_conversation_history";

export type GuardInput = {
  tenantAiEnabled: boolean;
  driverConfigured: boolean;
  conversationAiDisabled: boolean;
  optedOut: boolean;
  withinWindow: boolean;
  repliesTodayForConversation: number;
  repliesTodayForTenant: number;
  maxPerConversationPerDay: number;
  maxPerTenantPerDay: number;
  /** One channel's share of the tenant budget, when that channel has one.
   * Absent means "no sub-cap", which is what WhatsApp has. */
  repliesTodayForChannel?: number;
  maxPerChannelPerDay?: number;
};

export type GuardVerdict = { allowed: true } | { allowed: false; reason: AiSkipReason };

/**
 * Pure so the guard order is directly testable. The order is deliberate:
 * the cheap, categorical refusals come first, and the 24h window is checked
 * before either cap so a closed window is never reported as a quota problem.
 */
export function evaluateGuards(input: GuardInput): GuardVerdict {
  if (!input.tenantAiEnabled) return { allowed: false, reason: "ai_disabled_for_tenant" };
  if (!input.driverConfigured) return { allowed: false, reason: "ai_not_configured" };
  if (input.conversationAiDisabled) {
    return { allowed: false, reason: "conversation_ai_disabled" };
  }
  if (input.optedOut) return { allowed: false, reason: "contact_opted_out" };
  if (!input.withinWindow) return { allowed: false, reason: "window_closed" };
  if (input.repliesTodayForConversation >= input.maxPerConversationPerDay) {
    return { allowed: false, reason: "conversation_daily_cap" };
  }
  if (input.repliesTodayForTenant >= input.maxPerTenantPerDay) {
    return { allowed: false, reason: "tenant_daily_cap" };
  }
  // Checked after the shared ceiling, because the shared ceiling is the one
  // that bounds the bill. A channel sub-cap bounds something else: which
  // channel gets to spend it.
  if (
    input.maxPerChannelPerDay !== undefined &&
    (input.repliesTodayForChannel ?? 0) >= input.maxPerChannelPerDay
  ) {
    return { allowed: false, reason: "channel_daily_cap" };
  }
  return { allowed: true };
}

/**
 * The tenant-level mode is a ceiling, not a default: a flow node can choose
 * to stay on draft while the tenant is autonomous, but no node can send
 * while the tenant is on draft. That is what makes "start every tenant on
 * draft" (§10 1O) an actual guarantee rather than a form default — turning
 * one flow autonomous is a two-key operation.
 */
export function resolveMode(
  nodeMode: "draft" | "send" | undefined,
  tenantMode: "draft" | "send",
): "draft" | "send" {
  if (tenantMode !== "send") return "draft";
  return nodeMode === "send" ? "send" : "draft";
}

export type GenerateReplyInput = {
  contactId: string;
  /** Resolved from the contact's primary WhatsApp account when omitted. */
  conversationId?: string;
  /** Per-node extra instruction from the flow's ai_reply node. */
  instructions?: string;
  /** What the node asked for; narrowed by the tenant ceiling above. */
  mode?: "draft" | "send";
  flowRunId?: string;
  nodeId?: string;
};

export async function generateAiReply(
  ctx: TenantContext,
  input: GenerateReplyInput,
): Promise<AiReplyOutcome> {
  const config = await getAiConfig(ctx);
  const driver = getAiDriver();

  const conversation = await resolveConversation(ctx, input);
  if (!conversation) {
    // Distinguishes "this tenant has no connected number" from "this contact
    // has no thread", because they need different fixes from the operator.
    const account = await getPrimaryAccount(ctx);
    return { status: "skipped", reason: account ? "no_conversation" : "no_whatsapp_account" };
  }

  const { hasOptedOut } = await import("@/modules/automations/actions");

  const verdict = evaluateGuards({
    tenantAiEnabled: config.enabled,
    driverConfigured: !!driver,
    conversationAiDisabled: !!conversation.aiDisabledAt,
    optedOut: await hasOptedOut(ctx, input.contactId),
    withinWindow: isWithinFreeFormWindow(conversation.lastInboundAt),
    repliesTodayForConversation: await countRepliesTodayForConversation(ctx, conversation.id),
    repliesTodayForTenant: await countRepliesTodayForTenant(ctx),
    maxPerConversationPerDay: config.maxRepliesPerConversationPerDay,
    maxPerTenantPerDay: config.maxRepliesPerTenantPerDay,
  });
  if (!verdict.allowed) return { status: "skipped", reason: verdict.reason };
  if (!driver) return { status: "skipped", reason: "ai_not_configured" };

  const history = await listMessagesForConversation(ctx, conversation.id);
  // Only when the tenant opted in: a tenant who has not gets byte-identical
  // prompts to the ones they had before booking existed.
  const bookableTypes = config.bookingEnabled ? await listBookableForAi(ctx) : [];
  const prompt = buildReplyPrompt(
    { ...config.business, instructions: input.instructions, bookableTypes },
    history,
  );
  if (prompt.messages.length === 0) {
    // Nothing to reply to — a media-only thread, or one whose messages have
    // no text. Generating from business context alone would be the model
    // opening a conversation unprompted, which is not what this node is.
    return { status: "skipped", reason: "no_conversation_history" };
  }

  const mode = resolveMode(input.mode, config.mode);
  const promptText = serialisePrompt(prompt);

  let generated;
  try {
    generated = await driver.generateReply(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Persisted even on failure: a provider outage should be visible in the
    // audit trail, and the attempt still counts against the daily cap.
    const row = await recordReply(ctx, {
      conversationId: conversation.id,
      contactId: input.contactId,
      mode,
      status: "failed",
      prompt: promptText,
      provider: driver.provider,
      model: driver.model,
      flowRunId: input.flowRunId,
      nodeId: input.nodeId,
      error: message,
    });
    return { status: "failed", reason: message, replyId: row?.id };
  }

  // The marker is removed here, before the text is stored — not at send
  // time. A rep approving a draft in the inbox must see the message the
  // customer will get, and a customer must never see `[[SLOTS:corte]]`.
  const intent = extractBookingIntent(generated.text);

  const reply = await recordReply(ctx, {
    conversationId: conversation.id,
    contactId: input.contactId,
    mode,
    status: "draft",
    prompt: promptText,
    body: intent.text,
    provider: driver.provider,
    model: generated.model,
    promptTokens: generated.promptTokens,
    completionTokens: generated.completionTokens,
    flowRunId: input.flowRunId,
    nodeId: input.nodeId,
  });
  if (!reply) return { status: "failed", reason: "No se pudo guardar la respuesta generada" };

  if (mode === "draft") return { status: "draft", replyId: reply.id };

  const sent = await deliverReply(ctx, reply.id);

  // The slot list follows the reply, and only if the reply actually went out
  // — offering times underneath a message that failed to send would be a
  // picker with no question above it. The assistant never reserves: the
  // customer's tap does, through the ordinary transactional path.
  if (sent.status === "sent" && intent.bookingTypeSlug && config.bookingEnabled) {
    await offerSlotsForSlug(ctx, conversation.id, intent.bookingTypeSlug);
  }

  return sent;
}

/** Active bookable types, in the shape the prompt needs. */
async function listBookableForAi(
  ctx: TenantContext,
): Promise<Array<{ slug: string; name: string }>> {
  const { listBookingTypes } = await import("@/modules/booking/types");
  const types = await listBookingTypes(ctx);
  return types
    .filter((type) => type.isActive)
    .map((type) => ({ slug: type.slug, name: type.name }));
}

/**
 * Offers slots for the type the model named. A slug that does not resolve is
 * dropped in silence: the model inventing a service is exactly the failure
 * the guardrails already exist for, and the customer has just been sent a
 * perfectly good message either way.
 */
async function offerSlotsForSlug(
  ctx: TenantContext,
  conversationId: string,
  slug: string,
): Promise<void> {
  const { getBookingTypeBySlug } = await import("@/modules/booking/types");
  const { offerSlots } = await import("@/modules/booking/whatsapp-booking");

  const type = await getBookingTypeBySlug(ctx, slug);
  if (!type || !type.isActive) return;
  await offerSlots(ctx, { conversationId, bookingTypeId: type.id });
}

/**
 * Sends a stored reply. Used both by autonomous mode above and by a rep
 * approving a draft from the inbox — which is why every guard that can have
 * changed since generation is re-checked here. A draft written an hour ago
 * may now be outside the window, or the rep may have hit the kill switch;
 * either way this refuses rather than sending.
 */
export async function deliverReply(
  ctx: TenantContext,
  replyId: string,
  approvedByUserId?: string,
): Promise<AiReplyOutcome> {
  const reply = await getReply(ctx, replyId);
  if (!reply) return { status: "failed", reason: "Respuesta no encontrada" };
  if (reply.status === "sent") {
    return { status: "sent", replyId: reply.id, messageId: reply.messageId ?? "" };
  }
  if (!reply.body) return { status: "failed", reason: "La respuesta no tiene texto", replyId };
  // `ai_replies` is shared with the website chat widget since
  // docs/SPEC-CHAT-WIDGET.md §1.3 (one table so the per-tenant spend cap
  // stays one number). This path delivers over WhatsApp and nothing else: a
  // chat row has no conversation to send into, and must be refused here
  // rather than reaching sendText with a null.
  if (reply.channel !== "whatsapp" || !reply.conversationId) {
    return { status: "failed", reason: "La respuesta no es de WhatsApp", replyId };
  }

  const conversation = await getConversation(ctx, reply.conversationId);
  if (!conversation) return { status: "skipped", reason: "no_conversation" };
  if (conversation.aiDisabledAt) {
    return { status: "skipped", reason: "conversation_ai_disabled" };
  }
  if (!isWithinFreeFormWindow(conversation.lastInboundAt)) {
    return { status: "skipped", reason: "window_closed" };
  }

  const { hasOptedOut } = await import("@/modules/automations/actions");
  if (reply.contactId && (await hasOptedOut(ctx, reply.contactId))) {
    return { status: "skipped", reason: "contact_opted_out" };
  }

  try {
    // sendText re-checks the window itself and throws if it has closed
    // between the check above and here — the last of the three layers.
    const messageId = await sendText(ctx, {
      conversationId: reply.conversationId,
      body: reply.body,
    });

    if (reply.flowRunId) {
      await tenantDb(ctx)
        .update(messages)
        .set({ automationRunId: reply.flowRunId })
        .where(eq(messages.id, messageId));
    }

    await markReplySent(ctx, reply.id, messageId, approvedByUserId);
    return { status: "sent", replyId: reply.id, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markReplyFailed(ctx, reply.id, message);
    return { status: "failed", reason: message, replyId: reply.id };
  }
}

async function resolveConversation(ctx: TenantContext, input: GenerateReplyInput) {
  if (input.conversationId) return getConversation(ctx, input.conversationId);

  const account = await getPrimaryAccount(ctx);
  if (!account) return null;

  const contact = await getContact(ctx, input.contactId);
  if (!contact) return null;

  return getOrCreateConversation(ctx, account.id, input.contactId);
}
