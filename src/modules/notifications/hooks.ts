import { whatsappEvents } from "@/modules/whatsapp/events";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { listUsersForTenant } from "@/modules/tenancy/users";
import { getTenant } from "@/modules/tenancy/tenants";
import { getTranslator } from "@/lib/i18n/translator";
import { reportError } from "@/lib/observability";
import { createNotification } from "./notifications";
import { inboundThrottle, recipientsForInbound } from "./fanout";
import { enqueuePush } from "./queue";

// What causes a push that isn't already a `notifications` row (PLAN.md §15.5
// J2). Everything else — `notify_user`, a task coming due, anything a later
// phase writes — reaches a phone through createNotification, which enqueues
// the push itself. Only the two WhatsApp events are wired here, and only one
// of them writes a row.

let registered = false;

/** Idempotent for the same reason registerAutomationTriggers is: the worker
 * and the Next server both import this module's jobs file, and a second copy
 * of every listener is a second push for every message. */
export function registerNotificationHooks(): void {
  if (registered) return;
  registered = true;

  whatsappEvents.on("wa.message_received", async (event) => {
    await guarded("inbound", () => pushInboundMessage(event));
  });

  whatsappEvents.on("wa.conversation_assigned", async (event) => {
    await guarded("assignment", () => notifyAssignment(event));
  });
}

/**
 * A customer wrote (PLAN.md §15.5 J2).
 *
 * The one push in the product with no `notifications` row behind it, on
 * purpose: an inbound message already has a home — the inbox, with its unread
 * count — and mirroring every one of them into the bell would bury the
 * notifications that actually ask a person to do something. The push is the
 * nudge; the inbox is the record.
 *
 * Which is also why the two-minute throttle sits here and not in the job: a
 * customer typing four lines in a row is one arrival, and four buzzes is how
 * somebody turns notifications off for good.
 */
async function pushInboundMessage(event: {
  tenantId: string;
  conversationId: string;
  contactId: string;
  messageId: string;
}): Promise<void> {
  if (!inboundThrottle.claim(event.conversationId)) return;

  const ctx = await buildSystemTenantContext(event.tenantId);
  if (!ctx) return;

  const [{ getConversation, listMessagesForConversation }, { getContact }] = await Promise.all([
    import("@/modules/whatsapp/inbox"),
    import("@/modules/crm/contacts"),
  ]);

  const conversation = await getConversation(ctx, event.conversationId);
  if (!conversation) return;

  const users = await listUsersForTenant(event.tenantId);
  const activeUserIds = users.filter((user) => !user.banned).map((user) => user.id);
  const recipients = recipientsForInbound(conversation.assignedUserId, activeUserIds);
  if (recipients.length === 0) return;

  const contact = await getContact(ctx, event.contactId);
  const messages = await listMessagesForConversation(ctx, event.conversationId);
  const body = messages.find((message) => message.id === event.messageId)?.body ?? "";
  const tenantLocale = (await getTenant(ctx.tenantId))?.locale ?? null;

  const url = `/inbox/${event.conversationId}`;
  for (const userId of recipients) {
    // The *recipient's* language, falling back to the business's — the same
    // rule the daily reminder mail follows (§13 H5 #4).
    const t = await getTranslator(
      users.find((user) => user.id === userId)?.locale ?? tenantLocale,
      "app.push",
    );
    await enqueuePush(event.tenantId, userId, "inbound_message", {
      title: contact?.name?.trim() || t("inboundFallbackTitle"),
      body: body.trim() ? preview(body) : t("inboundNoText"),
      url,
      // Collapses in the tray: a second message from the same conversation
      // replaces the first rather than stacking under it.
      tag: `conversation:${event.conversationId}`,
    });
  }
}

/**
 * Somebody handed this conversation to a person (PLAN.md §15.5 J2).
 *
 * This one *does* write a row: being given a conversation is work assigned to
 * you, which belongs in the bell whether or not a push ever arrives — and the
 * row is what carries it to an iPhone, where there is no push at all.
 * createNotification enqueues the push from there.
 */
async function notifyAssignment(event: {
  tenantId: string;
  conversationId: string;
  contactId: string;
  assignedUserId: string | null;
  assignedByUserId: string;
}): Promise<void> {
  // Unassigning notifies nobody, and nobody needs telling they just took a
  // conversation themselves.
  if (!event.assignedUserId || event.assignedUserId === event.assignedByUserId) return;

  const ctx = await buildSystemTenantContext(event.tenantId);
  if (!ctx) return;

  const { getContact } = await import("@/modules/crm/contacts");
  const contact = await getContact(ctx, event.contactId);

  const users = await listUsersForTenant(event.tenantId);
  const recipient = users.find((user) => user.id === event.assignedUserId);
  if (!recipient || recipient.banned) return;

  const tenantLocale = (await getTenant(ctx.tenantId))?.locale ?? null;
  const t = await getTranslator(recipient.locale ?? tenantLocale, "app.push");
  await createNotification(ctx, {
    userId: event.assignedUserId,
    kind: "assignment",
    title: t("assignedTitle"),
    body: t("assignedBody", { contact: contact?.name?.trim() || t("inboundFallbackTitle") }),
    url: `/inbox/${event.conversationId}`,
  });
}

const PREVIEW_LENGTH = 120;

/** Push services cap the encrypted payload, and a notification tray truncates
 * long before that — a preview is all that ever gets read. */
function preview(body: string): string {
  const text = body.trim().replace(/\s+/g, " ");
  return text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
}

/**
 * A notification is never the point of the operation that caused it. A
 * WhatsApp webhook must answer 200 whether or not a push went out, so a
 * failure here is reported and swallowed rather than allowed to escape into
 * the listener chain — where it would take the automation triggers down with
 * it, since the event bus awaits its listeners in order.
 */
async function guarded(area: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    reportError(err, { tags: { area: "notifications", hook: area } });
  }
}
