import { enqueue } from "@/lib/queue";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { crmEvents } from "@/modules/crm/events";
import { leadEvents } from "@/modules/leads/events";
import { bookingEvents } from "@/modules/booking/events";
import { chatEvents } from "@/modules/chatwidget/events";
import { quoteEvents } from "@/modules/quotes/events";
import { documentEvents } from "@/modules/documents/events";
import { whatsappEvents } from "@/modules/whatsapp/events";
import { listActiveFlowsForTrigger } from "./flows";
import { startRun } from "./engine";
import type { TriggerType } from "./graph";

// Trigger wiring (PLAN.md §5 "events", §7.2): domain events enqueue an
// `automation.trigger` job; the handler matches active flows and starts
// runs. Events stay synchronous and cheap — the matching happens off the
// request path so a slow flow can never slow down a webhook or form post.

export type TriggerPayload = {
  tenantId: string;
  triggerType: TriggerType;
  contactId: string;
  data: Record<string, unknown>;
};

export async function fireTrigger(payload: TriggerPayload) {
  await enqueue("automation.trigger", payload, { tenantId: payload.tenantId });
}

/** `automation.trigger` job body — match flows, apply guards, start runs. */
export async function dispatchTrigger(payload: TriggerPayload) {
  const ctx = await buildSystemTenantContext(payload.tenantId);
  if (!ctx) return;

  const flows = await listActiveFlowsForTrigger(ctx, payload.triggerType);

  for (const flow of flows) {
    if (!matchesTriggerConfig(flow.triggerConfig as Record<string, unknown>, payload)) continue;

    await startRun(ctx, {
      flowId: flow.id,
      flowVersionId: flow.publishedVersionId!,
      contactId: payload.contactId,
      startedBy: { triggerType: payload.triggerType, ...payload.data },
    });
  }
}

/**
 * Per-trigger narrowing configured on the flow (§7.1) — e.g. only this form,
 * only this pipeline stage, only messages containing a keyword. An empty
 * config matches everything.
 */
function matchesTriggerConfig(
  config: Record<string, unknown>,
  payload: TriggerPayload,
): boolean {
  if (config.formId && config.formId !== payload.data.formId) return false;
  if (config.siteId && config.siteId !== payload.data.siteId) return false;
  if (config.stageId && config.stageId !== payload.data.toStageId) return false;
  if (config.tagId && config.tagId !== payload.data.tagId) return false;
  if (config.bookingTypeId && config.bookingTypeId !== payload.data.bookingTypeId) return false;
  if (config.widgetId && config.widgetId !== payload.data.widgetId) return false;

  if (config.keyword) {
    const body = String(payload.data.body ?? "").toLowerCase();
    if (!body.includes(String(config.keyword).toLowerCase())) return false;
  }

  return true;
}

let registered = false;

/**
 * Subscribes the engine to the domain event buses. Idempotent because the
 * worker and the Next server both import this module and each would
 * otherwise add its own copy of every listener — producing duplicate runs.
 */
export function registerAutomationTriggers() {
  if (registered) return;
  registered = true;

  crmEvents.on("contact.created", async ({ tenantId, contactId }) => {
    await fireTrigger({ tenantId, triggerType: "contact_created", contactId, data: {} });
  });

  crmEvents.on("tag.added", async ({ tenantId, contactId, tagId }) => {
    await fireTrigger({ tenantId, triggerType: "tag_added", contactId, data: { tagId } });
  });

  crmEvents.on("deal.stage_changed", async ({ tenantId, dealId, fromStageId, toStageId }) => {
    const ctx = await buildSystemTenantContext(tenantId);
    if (!ctx) return;
    const contactId = await contactForDeal(ctx, dealId);
    if (!contactId) return;

    await fireTrigger({
      tenantId,
      triggerType: "deal_stage_changed",
      contactId,
      data: { dealId, fromStageId, toStageId },
    });

    // Won/lost is derived from where the deal landed rather than emitted by
    // `closeDeal` (§15.5 J1). The stage flags are the definition of won and
    // lost in this product, so a card dragged into "Ganado" on the board
    // fires exactly what the close button fires — and one listener covers
    // both paths instead of two emit sites that can drift.
    const outcome = await outcomeOfStage(ctx, toStageId);
    if (outcome) {
      await fireTrigger({
        tenantId,
        triggerType: outcome === "won" ? "deal_won" : "deal_lost",
        contactId,
        data: { dealId, fromStageId, toStageId },
      });
    }
  });

  // Sales documents (§15.5 J1). Each event already carries the contact, so
  // unlike the deal events above these need no lookup.
  quoteEvents.on("quote.sent", async ({ tenantId, contactId, quoteId, dealId, number, total }) => {
    await fireTrigger({
      tenantId,
      triggerType: "quote_sent",
      contactId,
      data: { quoteId, dealId, number, total },
    });
  });

  quoteEvents.on(
    "quote.accepted",
    async ({ tenantId, contactId, quoteId, dealId, number, total }) => {
      await fireTrigger({
        tenantId,
        triggerType: "quote_accepted",
        contactId,
        data: { quoteId, dealId, number, total },
      });
    },
  );

  documentEvents.on(
    "document.sent",
    async ({ tenantId, contactId, documentId, dealId, number, total }) => {
      await fireTrigger({
        tenantId,
        triggerType: "document_sent",
        contactId,
        data: { documentId, dealId, number, total },
      });
    },
  );

  documentEvents.on(
    "document.paid",
    async ({ tenantId, contactId, documentId, dealId, number, total }) => {
      await fireTrigger({
        tenantId,
        triggerType: "document_paid",
        contactId,
        data: { documentId, dealId, number, total },
      });
    },
  );

  leadEvents.on("lead.received", async ({ tenantId, contactId, formId, siteId }) => {
    // A hosted-form lead fires both triggers so a flow can target either
    // "any lead" or "this specific form".
    await fireTrigger({
      tenantId,
      triggerType: "lead_received",
      contactId,
      data: { formId, siteId },
    });
    if (formId) {
      await fireTrigger({
        tenantId,
        triggerType: "form_submitted",
        contactId,
        data: { formId },
      });
    }
  });

  // Booking (docs/SPEC-BOOKING.md §7). `booking.created` also reaches
  // `lead_received` through the shared ingest engine, since a booking *is* a
  // lead — a flow that wants only bookings narrows on bookingTypeId, and one
  // that wants every inbound stranger keeps working unchanged.
  bookingEvents.on("booking.created", async ({ tenantId, contactId, bookingId, bookingTypeId, startsAt }) => {
    await fireTrigger({
      tenantId,
      triggerType: "booking_created",
      contactId,
      data: { bookingId, bookingTypeId, startsAt: startsAt.toISOString() },
    });
  });

  bookingEvents.on(
    "booking.cancelled",
    async ({ tenantId, contactId, bookingId, bookingTypeId, cancelledBy, cancelReason }) => {
      // The cancel half of a reschedule is bookkeeping, not a cancellation.
      // Firing `booking_cancelled` here would send "sentimos que cancelaste"
      // to someone who moved their appointment by fifteen minutes — and the
      // `booking_created` for the new row is already on its way.
      if (cancelledBy === "system" && cancelReason === "rescheduled") return;
      await fireTrigger({
        tenantId,
        triggerType: "booking_cancelled",
        contactId,
        data: { bookingId, bookingTypeId, cancelledBy },
      });
    },
  );

  bookingEvents.on("booking.no_show", async ({ tenantId, contactId, bookingId, bookingTypeId }) => {
    await fireTrigger({
      tenantId,
      triggerType: "booking_no_show",
      contactId,
      data: { bookingId, bookingTypeId },
    });
  });

  bookingEvents.on("booking.completed", async ({ tenantId, contactId, bookingId, bookingTypeId }) => {
    await fireTrigger({
      tenantId,
      triggerType: "booking_completed",
      contactId,
      data: { bookingId, bookingTypeId },
    });
  });

  chatEvents.on("chat.captured", async ({ tenantId, contactId, widgetId, siteId }) => {
    await fireTrigger({
      tenantId,
      triggerType: "chat_lead_captured",
      contactId,
      data: { widgetId, siteId },
    });
  });

  // A voice note whose transcription is still queued is handled on
  // `wa.message_transcribed` instead (§15.10 W1) — the same work, once the
  // message has words in it. Both paths run onInboundMessage below, so the
  // opt-out check, the handoff keyword and every flow see the transcript
  // rather than an empty body.
  whatsappEvents.on("wa.message_received", async (event) => {
    if (event.transcriptPending) return;
    await onInboundMessage(event);
  });

  whatsappEvents.on("wa.message_transcribed", async (event) => {
    await onInboundMessage(event);
  });
}

async function onInboundMessage({
  tenantId,
  contactId,
  messageId,
}: {
  tenantId: string;
  contactId: string;
  messageId: string;
}): Promise<void> {
  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return;

  const body = await messageBody(ctx, messageId);

  // An inbound reply resumes any run parked on wait-for-reply *before*
  // new flows are matched, so a reply advances the conversation the
  // contact is already in rather than only starting another one.
  const { resumeOnReply } = await import("./engine");
  await resumeOnReply(ctx, contactId);

  await maybeOptOut(ctx, contactId, body);
  await maybeAiHandoff(ctx, contactId, body);

  await fireTrigger({
    tenantId,
    triggerType: "wa_message_received",
    contactId,
    data: { messageId, body },
  });
}

/**
 * Whether a stage is the pipeline's won or lost column. Null for an ordinary
 * stage — most stage changes are neither, and this runs on every one of them.
 */
async function outcomeOfStage(
  ctx: TenantContext,
  stageId: string,
): Promise<"won" | "lost" | null> {
  const { getStage } = await import("@/modules/crm/pipelines");
  const stage = await getStage(ctx, stageId);
  if (!stage) return null;
  if (stage.isWon) return "won";
  if (stage.isLost) return "lost";
  return null;
}

async function contactForDeal(ctx: TenantContext, dealId: string): Promise<string | null> {
  const { getDeal } = await import("@/modules/crm/deals");
  const deal = await getDeal(ctx, dealId);
  return deal?.contactId ?? null;
}

/** The text of a message — the transcript when it is a voice note (§15.10
 *  W1), so "BAJA" said out loud opts a contact out exactly like "BAJA"
 *  typed, and a flow's wait-for-reply hears an audio the same way. */
async function messageBody(ctx: TenantContext, messageId: string): Promise<string> {
  const { eq } = await import("drizzle-orm");
  const { messages } = await import("@/db/schema");
  const { tenantDb } = await import("@/modules/tenancy/db");
  const [row] = await tenantDb(ctx).select(messages, eq(messages.id, messageId));
  if (!row) return "";
  const body = (row.body ?? "").trim();
  if (body) return body;
  return row.transcriptStatus === "done" ? (row.transcript ?? "") : "";
}

/**
 * Global opt-out (§7.2): an inbound BAJA/STOP tags the contact `optout`,
 * which every send action then honours. Done here rather than in a flow so
 * it applies even to tenants who never build one.
 */
const OPTOUT_KEYWORDS = ["baja", "stop", "cancelar suscripcion", "cancelar suscripción"];

async function maybeOptOut(ctx: TenantContext, contactId: string, body: string) {
  const normalized = body.trim().toLowerCase();
  if (!OPTOUT_KEYWORDS.some((keyword) => normalized === keyword)) return;

  const { listTags, createTag, addTagToContact } = await import("@/modules/crm/contacts");
  const { OPTOUT_TAG } = await import("./actions");

  const tags = await listTags(ctx);
  const existing = tags.find((tag) => tag.name.toLowerCase() === OPTOUT_TAG);
  const tag = existing ?? (await createTag(ctx, { name: OPTOUT_TAG }));
  if (tag) await addTagToContact(ctx, contactId, tag.id);
}

/**
 * AI handoff keyword (PLAN.md §10 1O): an inbound message equal to the
 * tenant's keyword permanently silences the bot for that contact. Done here,
 * next to opt-out and for the same reason — it has to work for a customer
 * who asks for a human regardless of which flow (if any) is running, and
 * regardless of whether the tenant ever built one.
 *
 * It silences only the AI. Reps keep replying in the same thread, which is
 * the entire point of asking for a human.
 */
async function maybeAiHandoff(ctx: TenantContext, contactId: string, body: string) {
  const normalized = body.trim().toLowerCase();
  if (!normalized) return;

  const { getAiConfig } = await import("@/modules/ai/config");
  const config = await getAiConfig(ctx);
  if (!config.handoffKeyword || normalized !== config.handoffKeyword) return;

  const { listConversationsForContact } = await import("@/modules/whatsapp/inbox");
  const { setConversationAiEnabled } = await import("@/modules/ai/replies");

  for (const conversation of await listConversationsForContact(ctx, contactId)) {
    if (conversation.aiDisabledAt) continue;
    await setConversationAiEnabled(ctx, conversation.id, false);
  }
}
