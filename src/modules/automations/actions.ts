import { eq } from "drizzle-orm";
import { messages } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import {
  addTagToContact,
  removeTagFromContact,
  listTagsForContact,
  getContact,
} from "@/modules/crm/contacts";
import { listDealsForContact, moveDeal, assignDeal } from "@/modules/crm/deals";
import { createActivity } from "@/modules/crm/activities";
import { getPrimaryAccount } from "@/modules/whatsapp/accounts";
import { getOrCreateConversation } from "@/modules/whatsapp/inbox";
import { sendText, sendTemplate } from "@/modules/whatsapp/send";
import { offerSlots } from "@/modules/booking/whatsapp-booking";
import type { FlowNode } from "./graph";

// Action nodes (PLAN.md §7.1) and the guards every send has to respect (§7.2).

/**
 * Global opt-out (§7.2): a contact tagged `optout` — applied automatically on
 * an inbound BAJA/STOP — is skipped by every send action. Checked here, in
 * the one place all automated sends pass through, rather than at each call
 * site where it could be forgotten.
 */
export const OPTOUT_TAG = "optout";

export type ActionResult = { skipped: boolean; detail: Record<string, unknown> };

export async function hasOptedOut(ctx: TenantContext, contactId: string): Promise<boolean> {
  const tags = await listTagsForContact(ctx, contactId);
  return tags.some((tag) => tag.name.toLowerCase() === OPTOUT_TAG);
}

export async function executeAction(
  ctx: TenantContext,
  node: Extract<FlowNode, { type: "action" }>,
  contactId: string,
  runId: string,
): Promise<ActionResult> {
  const config = node.config as Record<string, unknown>;
  const kind = String(config.kind);

  if (kind === "send_whatsapp" || kind === "send_template") {
    if (await hasOptedOut(ctx, contactId)) {
      return { skipped: true, detail: { reason: "contact_opted_out" } };
    }
    return sendWhatsappAction(ctx, kind, config, contactId, runId);
  }

  if (kind === "ai_reply") {
    return aiReplyAction(ctx, node.id, config, contactId, runId);
  }

  if (kind === "offer_slots") {
    if (await hasOptedOut(ctx, contactId)) {
      return { skipped: true, detail: { reason: "contact_opted_out" } };
    }
    return offerSlotsAction(ctx, config, contactId);
  }

  if (kind === "send_review_request") {
    if (await hasOptedOut(ctx, contactId)) {
      return { skipped: true, detail: { reason: "contact_opted_out" } };
    }
    return sendReviewRequestAction(ctx, config, contactId, runId);
  }

  if (kind === "send_email") {
    if (await hasOptedOut(ctx, contactId)) {
      return { skipped: true, detail: { reason: "contact_opted_out" } };
    }
    return sendEmailAction(ctx, config, contactId);
  }

  switch (kind) {
    case "create_task":
      return createTaskAction(ctx, config, contactId, runId);

    case "notify_user":
      return notifyUserAction(ctx, config, contactId, runId);

    case "add_tag":
      await addTagToContact(ctx, contactId, String(config.tagId));
      return { skipped: false, detail: { tagId: config.tagId } };

    case "remove_tag":
      await removeTagFromContact(ctx, contactId, String(config.tagId));
      return { skipped: false, detail: { tagId: config.tagId } };

    case "move_deal_stage": {
      const deals = await listDealsForContact(ctx, contactId);
      const deal = deals[0];
      if (!deal) return { skipped: true, detail: { reason: "no_deal" } };
      await moveDeal(ctx, deal.id, { toStageId: String(config.stageId), toPosition: 0 });
      return { skipped: false, detail: { dealId: deal.id, stageId: config.stageId } };
    }

    case "assign_user": {
      const deals = await listDealsForContact(ctx, contactId);
      const deal = deals[0];
      if (!deal) return { skipped: true, detail: { reason: "no_deal" } };
      await assignDeal(ctx, deal.id, String(config.userId));
      return { skipped: false, detail: { dealId: deal.id, userId: config.userId } };
    }

    case "create_note":
      await createActivity(ctx, {
        contactId,
        type: "note",
        payload: { text: String(config.text ?? ""), automationRunId: runId },
      });
      return { skipped: false, detail: {} };

    default:
      return { skipped: true, detail: { reason: `unknown_action:${kind}` } };
  }
}

/**
 * A task for a human (§15.5 J1). The assignee is resolved from the record
 * rather than pinned in the graph wherever possible: "the deal owner" keeps
 * meaning the right person after the deal is reassigned, which a hardcoded
 * user id does not.
 */
async function createTaskAction(
  ctx: TenantContext,
  config: Record<string, unknown>,
  contactId: string,
  runId: string,
): Promise<ActionResult> {
  const { createTask } = await import("@/modules/crm/tasks");

  const title = String(config.title ?? "").trim();
  if (!title) return { skipped: true, detail: { reason: "no_title" } };

  const dueInHours = Number(config.dueInHours ?? 24);
  const hours = Number.isFinite(dueInHours) && dueInHours >= 0 ? dueInHours : 24;

  const deals = await listDealsForContact(ctx, contactId);
  const deal = deals[0] ?? null;
  const assignedUserId = await resolveAssignee(ctx, config, contactId, deal);

  const contact = await getContact(ctx, contactId);
  const task = await createTask(ctx, {
    contactId,
    dealId: deal?.id,
    title: renderTemplateVars(title, contact).slice(0, 300),
    dueAt: new Date(Date.now() + hours * 60 * 60_000),
    assignedUserId: assignedUserId ?? undefined,
  });

  return {
    skipped: false,
    detail: { taskId: task?.id, assignedUserId, dueInHours: hours, runId },
  };
}

/**
 * `assignee`: `deal_owner` (default) | `contact_owner` | `specific`.
 * Unassigned is a legitimate outcome — a task nobody owns still shows up on
 * the team's list, which beats inventing an owner.
 */
async function resolveAssignee(
  ctx: TenantContext,
  config: Record<string, unknown>,
  contactId: string,
  deal: { assignedUserId: string | null } | null,
): Promise<string | null> {
  const mode = String(config.assignee ?? "deal_owner");

  if (mode === "specific") {
    const userId = String(config.userId ?? "").trim();
    return userId || null;
  }

  if (mode === "contact_owner") {
    const contact = await getContact(ctx, contactId);
    return contact?.ownerUserId ?? null;
  }

  // deal_owner, falling back to the contact's owner: a flow triggered by
  // something with no deal (a form submission, an inbound message) should
  // still land on somebody's list rather than nobody's.
  if (deal?.assignedUserId) return deal.assignedUserId;
  const contact = await getContact(ctx, contactId);
  return contact?.ownerUserId ?? null;
}

/**
 * An in-app notification for a team member (§15.5 J1). The row is written
 * here and P2 delivers it by push; until then the bell in the nav is the
 * whole delivery mechanism, which is why this writes a row rather than
 * calling a notifier.
 */
async function notifyUserAction(
  ctx: TenantContext,
  config: Record<string, unknown>,
  contactId: string,
  runId: string,
): Promise<ActionResult> {
  const { createNotification } = await import("@/modules/notifications/notifications");

  const deals = await listDealsForContact(ctx, contactId);
  const userId = await resolveAssignee(ctx, config, contactId, deals[0] ?? null);
  if (!userId) return { skipped: true, detail: { reason: "no_user" } };

  const contact = await getContact(ctx, contactId);
  const title = renderTemplateVars(String(config.title ?? ""), contact).trim();
  if (!title) return { skipped: true, detail: { reason: "no_title" } };

  const notification = await createNotification(ctx, {
    userId,
    kind: "automation",
    title,
    body: config.body ? renderTemplateVars(String(config.body), contact) : null,
    // Straight to the person the flow is about; a notification you cannot
    // act on from is a distraction.
    url: `/contacts/${contactId}`,
    flowRunId: runId,
  });

  return { skipped: false, detail: { notificationId: notification?.id, userId } };
}

/**
 * Email to the contact (§15.5 J1). A missing address or an unconfigured
 * Resend is a skipped step with a reason, never a failed run — the same
 * treatment a closed 24h window gets on WhatsApp, and the reason
 * lib/email's send never throws.
 *
 * P4 (§15.5 J3, §15.8) gives tenants their own sending identity: `sendEmail`
 * resolves `senderFor(ctx)` itself once it has a `ctx` and no explicit
 * `from`/`replyTo`, so this call site's only change is passing `ctx` and
 * `kind: "automated"` through — the resolution logic itself lives entirely
 * in lib/email, not here.
 */
async function sendEmailAction(
  ctx: TenantContext,
  config: Record<string, unknown>,
  contactId: string,
): Promise<ActionResult> {
  const { sendEmail } = await import("@/lib/email");

  const contact = await getContact(ctx, contactId);
  if (!contact?.email) return { skipped: true, detail: { reason: "no_contact_email" } };

  const subject = renderTemplateVars(String(config.subject ?? ""), contact).trim();
  const body = renderTemplateVars(String(config.body ?? ""), contact).trim();
  if (!subject || !body) return { skipped: true, detail: { reason: "no_content" } };

  const sent = await sendEmail({
    to: contact.email,
    subject,
    html: emailHtml(body),
    ctx,
    kind: "automated",
  });
  return sent
    ? { skipped: false, detail: { to: contact.email, subject } }
    : { skipped: true, detail: { reason: "email_not_configured", to: contact.email } };
}

/**
 * The tenant writes plain text with the same `{{variables}}` WhatsApp uses;
 * this is the minimum markup that keeps line breaks in an inbox. HTML in the
 * input is escaped rather than passed through — the body is tenant copy, not
 * a template, and an unescaped `<` from a price comparison should not eat
 * the rest of the message.
 */
function emailHtml(body: string): string {
  const escaped = body
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br />")}</p>`)
    .join("")}</div>`;
}

async function sendWhatsappAction(
  ctx: TenantContext,
  kind: string,
  config: Record<string, unknown>,
  contactId: string,
  runId: string,
): Promise<ActionResult> {
  const account = await getPrimaryAccount(ctx);
  if (!account) return { skipped: true, detail: { reason: "no_whatsapp_account" } };

  const conversation = await getOrCreateConversation(ctx, account.id, contactId);
  if (!conversation) return { skipped: true, detail: { reason: "no_conversation" } };

  if (kind === "send_template") {
    const messageId = await sendTemplate(ctx, {
      conversationId: conversation.id,
      templateName: String(config.templateName),
      language: String(config.language ?? "es"),
    });
    await stampAutomationRun(ctx, messageId, runId);
    return { skipped: false, detail: { messageId, template: config.templateName } };
  }

  // Free-form sends are only legal inside the 24h window (§6.4). Outside it
  // this is a skip with a reason, not a failed run — the flow should carry
  // on to whatever comes next rather than dying.
  try {
    const messageId = await sendText(ctx, {
      conversationId: conversation.id,
      body: renderTemplateVars(String(config.text ?? ""), await getContact(ctx, contactId)),
    });
    await stampAutomationRun(ctx, messageId, runId);
    return { skipped: false, detail: { messageId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ventana de 24 horas")) {
      return { skipped: true, detail: { reason: "window_closed" } };
    }
    throw err;
  }
}

const DEFAULT_REVIEW_REQUEST_TEXT =
  "¡Gracias por confiar en nosotros! Si tenés un minuto, nos ayudaría mucho que dejes una reseña: {{review_link}}";

/**
 * GBP review request (PLAN.md §10 1R #5 / §10 1P). No Google API, no OAuth —
 * the tenant's own review link, sent like any other free-form WhatsApp send,
 * so it inherits every guard that already applies to one (opt-out above,
 * 24h window below).
 */
async function sendReviewRequestAction(
  ctx: TenantContext,
  config: Record<string, unknown>,
  contactId: string,
  runId: string,
): Promise<ActionResult> {
  const tenant = await getTenant(ctx.tenantId);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const reviewLink = settings.reviewLink;
  if (!reviewLink) return { skipped: true, detail: { reason: "no_review_link" } };

  const account = await getPrimaryAccount(ctx);
  if (!account) return { skipped: true, detail: { reason: "no_whatsapp_account" } };

  const conversation = await getOrCreateConversation(ctx, account.id, contactId);
  if (!conversation) return { skipped: true, detail: { reason: "no_conversation" } };

  const template = String(config.text ?? DEFAULT_REVIEW_REQUEST_TEXT);
  const contact = await getContact(ctx, contactId);
  const body = renderTemplateVars(template, contact).replaceAll("{{review_link}}", reviewLink);

  try {
    const messageId = await sendText(ctx, { conversationId: conversation.id, body });
    await stampAutomationRun(ctx, messageId, runId);
    return { skipped: false, detail: { messageId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ventana de 24 horas")) {
      return { skipped: true, detail: { reason: "window_closed" } };
    }
    throw err;
  }
}

/**
 * AI auto-reply node (PLAN.md §10 1O). Every rule — tenant enablement, the
 * draft/send ceiling, the 24h window, the daily caps, the per-conversation
 * kill switch — is enforced inside modules/ai, not here: this node is a thin
 * call into it so no future caller can reach the model around the guards.
 *
 * A guard refusal is a `skipped` step with a reason, never a failed run:
 * "the AI declined to answer this one" must not stop the follow-up branch
 * of a flow from running, exactly like a closed window on a free-form send.
 */
async function aiReplyAction(
  ctx: TenantContext,
  nodeId: string,
  config: Record<string, unknown>,
  contactId: string,
  runId: string,
): Promise<ActionResult> {
  const { generateAiReply } = await import("@/modules/ai/reply");

  const outcome = await generateAiReply(ctx, {
    contactId,
    instructions: config.instructions ? String(config.instructions) : undefined,
    mode: config.mode === "send" ? "send" : "draft",
    flowRunId: runId,
    nodeId,
  });

  switch (outcome.status) {
    case "sent":
      return {
        skipped: false,
        detail: { replyId: outcome.replyId, messageId: outcome.messageId, mode: "send" },
      };
    case "draft":
      return { skipped: false, detail: { replyId: outcome.replyId, mode: "draft" } };
    case "skipped":
      return { skipped: true, detail: { reason: outcome.reason } };
    case "failed":
      // Also a skip rather than a throw: an OpenAI 500 shouldn't kill a run
      // whose remaining steps (tagging, notifying a rep) still make sense.
      return { skipped: true, detail: { reason: "ai_failed", error: outcome.reason } };
  }
}

/**
 * Every automated send is a `messages` row carrying automation_run_id, so it
 * shows up in the inbox like any other message and is traceable back to the
 * run that produced it (§7.2).
 */
async function stampAutomationRun(ctx: TenantContext, messageId: string, runId: string) {
  await tenantDb(ctx)
    .update(messages)
    .set({ automationRunId: runId })
    .where(eq(messages.id, messageId));
}

/** Minimal {{contact.name}} / {{contact.phone}} substitution (§7.1). */
export function renderTemplateVars(
  text: string,
  contact: { name: string; phone: string } | null,
): string {
  if (!contact) return text;
  return text
    .replaceAll("{{contact.name}}", contact.name)
    .replaceAll("{{contact.phone}}", contact.phone);
}

/**
 * Offers bookable slots in the contact's thread (plan-booking.md §5.3).
 *
 * Everything about the reservation itself stays in the booking module: this
 * only picks the conversation. The tap that follows arrives as a webhook and
 * lands in the same transactional reserve the public page uses.
 */
async function offerSlotsAction(
  ctx: TenantContext,
  config: Record<string, unknown>,
  contactId: string,
): Promise<ActionResult> {
  const bookingTypeId = String(config.bookingTypeId ?? "");
  if (!bookingTypeId) return { skipped: true, detail: { reason: "no_booking_type" } };

  const account = await getPrimaryAccount(ctx);
  if (!account) return { skipped: true, detail: { reason: "no_wa_account" } };

  const conversation = await getOrCreateConversation(ctx, account.id, contactId);
  if (!conversation) return { skipped: true, detail: { reason: "no_conversation" } };

  const outcome = await offerSlots(ctx, { conversationId: conversation.id, bookingTypeId });
  return outcome.status === "offered"
    ? { skipped: false, detail: { bookingTypeId, offered: outcome.count } }
    : { skipped: true, detail: { reason: outcome.reason } };
}
