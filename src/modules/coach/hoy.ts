import { activities, contacts, deals, stages } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { getTranslator } from "@/lib/i18n/translator";
import { DEFAULT_TIMEZONE } from "@/lib/i18n/format";
import { listConversations } from "@/modules/whatsapp/inbox";
import { listQuotes } from "@/modules/quotes/quotes";
import { listOpenTasksForTenant } from "@/modules/crm/tasks";
import { listLeadSubmissions } from "@/modules/leads/stats";
import { listBookings } from "@/modules/booking/bookings";
import {
  isWithinBusinessHours,
  rankHoy,
  type HoyCandidate,
  type HoyItemKind,
  type HoySeverity,
  type RankHoyOptions,
} from "./rank";

// The "Hoy" panel (PLAN.md §15.3 L1, §15.5 J6, §15.8 P7): a ranked,
// rule-based list of what needs attention today, computed from tables the
// product already has — no AI in this phase. `rank.ts` holds the pure
// candidate rules and the ordering (unit tested there); this file is the
// DB reads, the cross-referencing between modules' own tables, and turning
// a ranked candidate into the text a person or a push notification reads.
//
// This is deliberately the same list on the dashboard and in the morning
// push (§15.3: "the same list is the body of the morning web push") — one
// tenant-locale render here rather than the dashboard translating in the
// viewer's own locale and the push job doing it again in the tenant's.

const STALE_QUOTE_DAYS = 3;
const LEAD_WINDOW_MS = 48 * 60 * 60 * 1000;
const BOOKING_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_STAGE_DAYS = 7;
const UNANSWERED_CONVERSATION_MS = 60 * 60 * 1000;

export type HoyItem = {
  kind: HoyItemKind;
  severity: HoySeverity;
  title: string;
  subtitle: string;
  url: string;
  action: string;
};

function unreadConversationCandidates(
  conversationRows: Awaited<ReturnType<typeof listConversations>>,
  contactNames: Map<string, string>,
  now: Date,
  withinBusinessHours: boolean,
): HoyCandidate[] {
  if (!withinBusinessHours) return [];

  return conversationRows
    .filter(
      (row) =>
        row.unreadCount > 0 &&
        row.lastInboundAt &&
        now.getTime() - row.lastInboundAt.getTime() >= UNANSWERED_CONVERSATION_MS,
    )
    .map((row) => {
      const minutes = Math.round((now.getTime() - row.lastInboundAt!.getTime()) / 60_000);
      return {
        kind: "unread_conversation" as const,
        assignedUserId: row.assignedUserId,
        urgency: minutes,
        url: `/inbox/${row.id}`,
        vars: { name: contactNames.get(row.contactId) ?? row.contactId, minutes },
      };
    });
}

function staleDealCandidates(
  dealRows: (typeof deals.$inferSelect)[],
  stageById: Map<string, typeof stages.$inferSelect>,
  now: Date,
): HoyCandidate[] {
  const results: HoyCandidate[] = [];
  for (const deal of dealRows) {
    const stage = stageById.get(deal.stageId);
    if (!stage || stage.isWon || stage.isLost) continue;

    const staleAfterDays = stage.staleAfterDays ?? DEFAULT_STALE_STAGE_DAYS;
    const daysInStage = (now.getTime() - deal.stageEnteredAt.getTime()) / 86_400_000;
    if (daysInStage < staleAfterDays) continue;

    results.push({
      kind: "stale_deal",
      assignedUserId: deal.assignedUserId,
      urgency: daysInStage,
      url: `/pipeline/${deal.id}`,
      vars: { title: deal.title, days: Math.floor(daysInStage) },
    });
  }
  return results;
}

function unrepliedQuoteCandidates(
  quoteRows: Awaited<ReturnType<typeof listQuotes>>,
  lastActivityByContact: Map<string, Date>,
  openTaskContactIds: Set<string>,
  dealAssigneeByDealId: Map<string, string | null>,
  now: Date,
): HoyCandidate[] {
  const results: HoyCandidate[] = [];
  for (const quote of quoteRows) {
    if (quote.status !== "sent" || !quote.sentAt) continue;

    const daysSinceSent = (now.getTime() - quote.sentAt.getTime()) / 86_400_000;
    if (daysSinceSent < STALE_QUOTE_DAYS) continue;

    // "No activity since" is asked of the contact, not the quote itself —
    // activities have no quote_id to key on. A rep who called or noted
    // anything on this customer after sending the quote has already
    // followed up, whatever the note says.
    const lastActivity = lastActivityByContact.get(quote.contactId);
    if (lastActivity && lastActivity > quote.sentAt) continue;
    if (openTaskContactIds.has(quote.contactId)) continue;

    results.push({
      kind: "unreplied_quote",
      assignedUserId: quote.dealId ? (dealAssigneeByDealId.get(quote.dealId) ?? null) : null,
      urgency: daysSinceSent,
      url: `/quotes/${quote.id}`,
      vars: { number: quote.number, days: Math.floor(daysSinceSent) },
    });
  }
  return results;
}

function leadWithoutDealCandidates(
  leadRows: Awaited<ReturnType<typeof listLeadSubmissions>>,
  contactNames: Map<string, string>,
  now: Date,
): HoyCandidate[] {
  return leadRows
    .filter((lead) => !lead.dealId && now.getTime() - lead.createdAt.getTime() <= LEAD_WINDOW_MS)
    .map((lead) => {
      const hours = Math.max(1, Math.round((now.getTime() - lead.createdAt.getTime()) / 3_600_000));
      return {
        // A fresher lead is more actionable than one about to age out of the
        // window, but both still deserve a reply today — urgency ranks by
        // how close it is to leaving the 48h window altogether.
        kind: "lead_without_deal" as const,
        assignedUserId: null,
        urgency: hours,
        url: `/contacts/${lead.contactId}`,
        vars: { name: contactNames.get(lead.contactId) ?? lead.contactId, hours },
      };
    });
}

function upcomingBookingCandidates(
  bookingRows: Awaited<ReturnType<typeof listBookings>>,
  contactNames: Map<string, string>,
  dealAssigneeByDealId: Map<string, string | null>,
  now: Date,
): HoyCandidate[] {
  return bookingRows
    .filter(
      (booking) =>
        booking.status === "confirmed" &&
        !booking.reminderSentAt &&
        booking.calendarEventId &&
        // Strictly future: `listBookings`'s own from/to filter is overlap-
        // based (an in-progress visit is still "today's"), but one already
        // under way is not an "upcoming" reminder to send anymore.
        booking.startsAt.getTime() > now.getTime() &&
        booking.startsAt.getTime() - now.getTime() <= BOOKING_WINDOW_MS,
    )
    .map((booking) => {
      const hoursUntil = (booking.startsAt.getTime() - now.getTime()) / 3_600_000;
      return {
        kind: "upcoming_booking" as const,
        assignedUserId: booking.dealId ? (dealAssigneeByDealId.get(booking.dealId) ?? null) : null,
        // Sooner is more urgent, so invert against the window size.
        urgency: BOOKING_WINDOW_MS / 3_600_000 - hoursUntil,
        url: `/calendar/${booking.calendarEventId}`,
        vars: {
          name: contactNames.get(booking.contactId) ?? booking.contactId,
          hours: Math.max(1, Math.round(hoursUntil)),
        },
      };
    });
}

function overdueTaskCandidates(
  taskRows: Awaited<ReturnType<typeof listOpenTasksForTenant>>,
  contactNames: Map<string, string>,
  now: Date,
): HoyCandidate[] {
  return taskRows
    .filter((task) => task.dueAt < now)
    .map((task) => {
      const daysOverdue = (now.getTime() - task.dueAt.getTime()) / 86_400_000;
      return {
        kind: "overdue_task" as const,
        assignedUserId: task.assignedUserId,
        urgency: daysOverdue,
        url: `/contacts/${task.contactId}`,
        vars: {
          title: task.title,
          name: contactNames.get(task.contactId) ?? task.contactId,
          days: Math.max(1, Math.floor(daysOverdue)),
        },
      };
    });
}

export async function buildHoy(
  ctx: TenantContext,
  now: Date = new Date(),
  options: RankHoyOptions = {},
): Promise<HoyItem[]> {
  const tenant = await getTenant(ctx.tenantId);
  const timeZone = tenant?.timezone || DEFAULT_TIMEZONE;
  const businessHours = ((tenant?.settings ?? {}) as TenantSettings).businessHours;

  const [
    conversationRows,
    dealRows,
    stageRows,
    quoteRows,
    contactRows,
    activityRows,
    taskRows,
    leadRows,
    bookingRows,
  ] = await Promise.all([
    listConversations(ctx, { filter: "all" }),
    tenantDb(ctx).select(deals),
    tenantDb(ctx).select(stages),
    listQuotes(ctx),
    tenantDb(ctx).select(contacts),
    tenantDb(ctx).select(activities),
    listOpenTasksForTenant(ctx),
    listLeadSubmissions(ctx, { since: new Date(now.getTime() - LEAD_WINDOW_MS) }),
    listBookings(ctx, {
      from: now,
      to: new Date(now.getTime() + BOOKING_WINDOW_MS),
      status: "confirmed",
    }),
  ]);

  const contactNames = new Map(contactRows.map((contact) => [contact.id, contact.name]));
  const stageById = new Map(stageRows.map((stage) => [stage.id, stage]));
  const dealAssigneeByDealId = new Map(dealRows.map((deal) => [deal.id, deal.assignedUserId]));
  const openTaskContactIds = new Set(taskRows.map((task) => task.contactId));

  const lastActivityByContact = new Map<string, Date>();
  for (const activity of activityRows) {
    const current = lastActivityByContact.get(activity.contactId);
    if (!current || activity.createdAt > current) {
      lastActivityByContact.set(activity.contactId, activity.createdAt);
    }
  }

  const withinBusinessHours = isWithinBusinessHours(businessHours, now, timeZone);

  const candidates: HoyCandidate[] = [
    ...unreadConversationCandidates(conversationRows, contactNames, now, withinBusinessHours),
    ...overdueTaskCandidates(taskRows, contactNames, now),
    ...upcomingBookingCandidates(bookingRows, contactNames, dealAssigneeByDealId, now),
    ...unrepliedQuoteCandidates(
      quoteRows,
      lastActivityByContact,
      openTaskContactIds,
      dealAssigneeByDealId,
      now,
    ),
    ...staleDealCandidates(dealRows, stageById, now),
    ...leadWithoutDealCandidates(leadRows, contactNames, now),
  ];

  const ranked = rankHoy(candidates, options);
  const t = await getTranslator(tenant?.locale, "app.dashboard.hoy");

  return ranked.map((candidate) => ({
    kind: candidate.kind,
    severity: candidate.severity,
    title: t(`${candidate.kind}.title`, candidate.vars),
    subtitle: t(`${candidate.kind}.subtitle`, candidate.vars),
    url: candidate.url,
    action: t(`${candidate.kind}.action`),
  }));
}
