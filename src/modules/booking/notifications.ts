import { and, desc, eq, inArray } from "drizzle-orm";
import { bookingNotifications, waTemplates } from "@/db/schema";
import { env } from "@/lib/config/env";
import { sendEmail } from "@/lib/email";
import { newId } from "@/lib/ids";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getContact } from "@/modules/crm/contacts";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { getPrimaryAccount } from "@/modules/whatsapp/accounts";
import { getOrCreateConversation, isWithinFreeFormWindow } from "@/modules/whatsapp/inbox";
import { sendTemplate, sendText } from "@/modules/whatsapp/send";
import { getBooking } from "./bookings";
import { getBookingType } from "./types";
import {
  channelChain,
  type BookingNotificationChannel,
  type BookingNotificationKind,
  type ChannelAvailability,
} from "./notification-chain";
import {
  BOOKING_TEMPLATES,
  BOOKING_TEMPLATE_LANGUAGE,
  buildEmail,
  buildFreeFormText,
  templateSendComponents,
  type BookingNotificationVars,
} from "./notification-templates";

// One implementation of "tell the customer something about their booking",
// used by confirmation, reminder, cancellation, reschedule, seña request and
// review request alike (plan-booking.md §5.1).
//
// It replaces the old reminder behaviour, which skipped in silence whenever
// the 24h window was shut — which, for a visitor who booked on the website
// and has never messaged the business, is always. The chain in
// ./notification-chain.ts is the fix; this module is the part that has to
// touch Meta, Resend and the database, and it writes down every rung it
// tried so the booking view can show what actually happened.

export type BookingNotification = typeof bookingNotifications.$inferSelect;

export type NotifyInput = {
  tenantId: string;
  bookingId: string;
  kind: BookingNotificationKind;
  /** The pre-move time, so a reschedule notice can name what changed. */
  previousStartsAt?: Date;
};

export type NotifyOutcome = {
  channel: BookingNotificationChannel;
  status: "sent" | "failed" | "skipped";
  detail?: string;
};

/**
 * Sends one notification, walking the chain until a rung takes it.
 *
 * Never throws. A notification that cannot be delivered is a fact about the
 * booking, not a failure of the operation that triggered it — a confirmed
 * reservation must not be rolled back because Meta was down, and a job must
 * not dead-letter over it.
 */
export async function notifyBooking(input: NotifyInput): Promise<NotifyOutcome> {
  try {
    return await deliver(input);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { channel: "none", status: "failed", detail: detail.slice(0, 500) };
  }
}

async function deliver(input: NotifyInput): Promise<NotifyOutcome> {
  const ctx = await buildSystemTenantContext(input.tenantId);
  if (!ctx) return { channel: "none", status: "skipped", detail: "tenant_not_found" };

  const booking = await getBooking(ctx, input.bookingId);
  if (!booking) return { channel: "none", status: "skipped", detail: "booking_not_found" };

  const [contact, type, tenant] = await Promise.all([
    getContact(ctx, booking.contactId),
    getBookingType(ctx, booking.bookingTypeId),
    getTenant(ctx.tenantId),
  ]);
  if (!contact || !type || !tenant) {
    return { channel: "none", status: "skipped", detail: "booking_context_missing" };
  }

  const settings = (tenant.settings ?? {}) as TenantSettings;
  const vars: BookingNotificationVars = {
    contactName: contact.name,
    businessName: tenant.name,
    serviceName: type.name,
    when: formatDateTime(booking.startsAt, tenant.locale, tenant.timezone),
    manageUrl: `${env.APP_URL}/b/g/${booking.publicToken}`,
    location: type.locationDetail,
    depositAmount: type.depositAmount
      ? formatMoney(type.depositAmount, type.depositCurrency, tenant.locale)
      : null,
    depositInstructions: settings.depositInstructions ?? null,
    reviewUrl: settings.reviewLink ?? null,
  };

  // The account and the conversation are resolved before the chain is
  // chosen, because "can we WhatsApp this person at all" is one of its four
  // inputs. Creating the conversation row here is safe and deliberate: it is
  // the thread this business already has with this contact, and the inbox
  // showing an empty one is better than an outbound message with no home.
  const account = await getPrimaryAccount(ctx);
  const conversation =
    account && contact.phone
      ? await getOrCreateConversation(ctx, account.id, contact.id)
      : null;

  const availability: ChannelAvailability = {
    whatsappReady: !!conversation,
    templateApproved: account
      ? await isTemplateApproved(ctx, account.id, BOOKING_TEMPLATES[input.kind].name)
      : false,
    windowOpen: !!conversation && isWithinFreeFormWindow(conversation.lastInboundAt),
    hasEmail: !!contact.email,
  };

  const chain = channelChain(availability);
  let lastError: string | undefined;

  for (const channel of chain) {
    if (channel === "none") break;
    try {
      const messageId = await send(ctx, channel, input.kind, vars, {
        conversationId: conversation?.id,
        email: contact.email,
      });
      await record(ctx, input, {
        channel,
        status: "sent",
        templateName: channel === "wa_template" ? BOOKING_TEMPLATES[input.kind].name : null,
        messageId,
        detail: null,
      });
      return { channel, status: "sent" };
    } catch (err) {
      lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      // Every failed rung is logged, not just the last one: "the template
      // was rejected and then the email bounced" is the answer staff need,
      // and it is invisible if only the final outcome is kept.
      await record(ctx, input, {
        channel,
        status: "failed",
        templateName: channel === "wa_template" ? BOOKING_TEMPLATES[input.kind].name : null,
        messageId: null,
        detail: lastError,
      });
    }
  }

  const detail = lastError ?? skipReason(availability);
  await record(ctx, input, {
    channel: "none",
    status: "skipped",
    templateName: null,
    messageId: null,
    detail,
  });
  return { channel: "none", status: "skipped", detail };
}

function skipReason(availability: ChannelAvailability): string {
  if (!availability.whatsappReady && !availability.hasEmail) return "no_channel";
  if (availability.whatsappReady) return "template_not_approved_and_window_closed";
  return "no_channel";
}

async function send(
  ctx: TenantContext,
  channel: BookingNotificationChannel,
  kind: BookingNotificationKind,
  vars: BookingNotificationVars,
  targets: { conversationId?: string; email?: string | null },
): Promise<string | null> {
  switch (channel) {
    case "wa_template":
      return sendTemplate(ctx, {
        conversationId: targets.conversationId!,
        templateName: BOOKING_TEMPLATES[kind].name,
        language: BOOKING_TEMPLATE_LANGUAGE,
        components: templateSendComponents(kind, vars),
      });
    case "wa_freeform":
      return sendText(ctx, {
        conversationId: targets.conversationId!,
        body: buildFreeFormText(kind, vars),
      });
    case "email": {
      const { subject, html } = buildEmail(kind, vars);
      // sendEmail never throws and returns false when Resend is unset or
      // rejects; the chain needs that to be a *failure* so it falls through
      // to the logged skip rather than claiming a send that never happened.
      const ok = await sendEmail({ to: targets.email!, subject, html });
      if (!ok) throw new Error("email_not_delivered");
      return null;
    }
    case "none":
      return null;
  }
}

async function isTemplateApproved(
  ctx: TenantContext,
  accountId: string,
  templateName: string,
): Promise<boolean> {
  const rows = await tenantDb(ctx).select(
    waTemplates,
    and(
      eq(waTemplates.waAccountId, accountId),
      eq(waTemplates.name, templateName),
      eq(waTemplates.language, BOOKING_TEMPLATE_LANGUAGE),
    ),
  );
  return rows.some((row) => row.status === "APPROVED");
}

async function record(
  ctx: TenantContext,
  input: NotifyInput,
  row: {
    channel: BookingNotificationChannel;
    status: "sent" | "failed" | "skipped";
    templateName: string | null;
    messageId: string | null;
    detail: string | null;
  },
): Promise<void> {
  await tenantDb(ctx)
    .insert(bookingNotifications)
    .values({
      id: newId(),
      bookingId: input.bookingId,
      kind: input.kind,
      channel: row.channel,
      status: row.status,
      templateName: row.templateName,
      messageId: row.messageId,
      detail: row.detail,
      sentAt: row.status === "sent" ? new Date() : null,
    });
}

/** The delivery timeline for one booking, newest first. */
export async function listBookingNotifications(
  ctx: TenantContext,
  bookingId: string,
): Promise<BookingNotification[]> {
  const rows = await tenantDb(ctx).select(
    bookingNotifications,
    eq(bookingNotifications.bookingId, bookingId),
  );
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * The same timelines for a set of bookings, in one query — the upcoming list
 * shows a delivery badge per row and must not fan out into one query per
 * booking to do it.
 */
export async function notificationsByBooking(
  ctx: TenantContext,
  bookingIds: string[],
): Promise<Map<string, BookingNotification[]>> {
  const byBooking = new Map<string, BookingNotification[]>();
  if (bookingIds.length === 0) return byBooking;

  const rows = await tenantDb(ctx)
    .select(bookingNotifications, inArray(bookingNotifications.bookingId, bookingIds))
    .orderBy(desc(bookingNotifications.createdAt));

  for (const row of rows) {
    const list = byBooking.get(row.bookingId);
    if (list) list.push(row);
    else byBooking.set(row.bookingId, [row]);
  }
  return byBooking;
}

/**
 * Mirrors a WhatsApp delivery-status webhook onto the notification row that
 * message belongs to, so the timeline can say "entregado" rather than
 * stopping at "enviado". Called from the webhook's status loop, which has
 * already applied `advancesMessageStatus` to the message itself.
 */
export async function advanceNotificationForMessage(
  ctx: TenantContext,
  messageId: string,
  status: "sent" | "delivered" | "read" | "failed",
): Promise<void> {
  await tenantDb(ctx)
    .update(bookingNotifications)
    .set({ status, updatedAt: new Date() })
    .where(eq(bookingNotifications.messageId, messageId));
}
