import { gt } from "drizzle-orm";
import {
  activities,
  contacts,
  conversations,
  deals,
  flows,
  forms,
  quotes,
  sites,
  stages,
  waAccounts,
} from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import type { ActivityType } from "@/modules/crm/activities";
import { listOpenTasksDueBy } from "@/modules/crm/tasks";
import { listCalendarEvents } from "@/modules/calendar/events";
import { startOfDay, addDays, todayIn } from "@/modules/calendar/zoned-time";
import { DEFAULT_TIMEZONE } from "@/lib/i18n/format";

// Tenant dashboard read model (PLAN.md §10 1C "dashboard"): summary counters
// plus the onboarding checklist state a brand-new tenant lands on.
//
// Everything goes through tenantDb — the scoped access layer is the only
// sanctioned path to tenant rows (§3.3, layer 2). Most counters still
// aggregate in memory because the rows are needed anyway (contact names,
// recent-activity ordering, the checklist flags) — fetching them once and
// deriving several numbers from the same rows costs nothing extra. The one
// counter that doesn't need its rows at all — unread messages/conversations,
// which used to `db.select(conversations)` and reduce over every row just to
// sum/count a column — now goes through tenantDb's `count`/`sum` (§14
// perf pass): the rows would otherwise be discarded, so pushing the
// aggregation into SQL turns "N rows" into two scalars.

const RECENT_ACTIVITY_LIMIT = 8;

/** Quotes still awaiting an outcome — what "pendientes" means on the card. */
const PENDING_QUOTE_STATUSES = new Set(["draft", "sent"]);

export type DashboardStats = {
  /** Deals sitting in a stage that is neither won nor lost. */
  openDeals: number;
  /** Summed value of those deals, guaraníes only (§4: no FX conversion). */
  openDealsValuePyg: number;
  /** Unread inbound WhatsApp messages across every conversation. */
  unreadMessages: number;
  unreadConversations: number;
  pendingQuotes: number;
  contacts: number;
};

/**
 * "Getting started" checklist state (§10 1C). Each flag is the cheap
 * existence question behind one step — a step is done the moment the tenant
 * has the thing, so the list empties itself as they set the CRM up.
 */
export type OnboardingChecklist = {
  whatsappConnected: boolean;
  hasContact: boolean;
  hasDeal: boolean;
  hasQuote: boolean;
  /** A site posting leads, or a hosted form — either capture path counts. */
  hasLeadCapture: boolean;
  hasActiveAutomation: boolean;
};

export type RecentActivity = {
  id: string;
  type: ActivityType;
  contactId: string;
  contactName: string;
  createdAt: Date;
};

export type DueTask = {
  id: string;
  title: string;
  dueAt: Date;
  contactId: string;
  contactName: string;
};

export type TodayAppointment = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  contactId: string | null;
  contactName: string | null;
  assignedUserId: string | null;
};

export type DashboardSummary = {
  stats: DashboardStats;
  checklist: OnboardingChecklist;
  recentActivity: RecentActivity[];
  /** Open tasks due now or earlier — overdue and due-today are the same
   * query (§10 1J #3), so the dashboard renders one list and lets the date
   * itself signal which is which. */
  dueTasks: DueTask[];
  /** Everything on today's agenda, in the tenant's timezone — the other half
   * of "what does today look like", which used to need a second screen. */
  todayAppointments: TodayAppointment[];
  /** True until every checklist step is done — drives showing the guide. */
  onboardingPending: boolean;
};

export async function getDashboardSummary(
  ctx: TenantContext,
  options: { timeZone?: string; now?: Date } = {},
): Promise<DashboardSummary> {
  const db = tenantDb(ctx);
  // "Today" is the tenant's today (§2.3): a nine o'clock visit belongs to the
  // day the business is living in, not the day the server happens to be in.
  const timeZone = options.timeZone ?? DEFAULT_TIMEZONE;
  const now = options.now ?? new Date();
  const today = todayIn(timeZone, now);

  const [
    dealRows,
    stageRows,
    unreadMessages,
    unreadConversations,
    quoteRows,
    contactRows,
    activityRows,
    waAccountRows,
    siteRows,
    formRows,
    flowRows,
    dueTaskRows,
    appointmentRows,
  ] = await Promise.all([
    db.select(deals),
    db.select(stages),
    db.sum(conversations, conversations.unreadCount),
    db.count(conversations, gt(conversations.unreadCount, 0)),
    db.select(quotes),
    db.select(contacts),
    db.select(activities),
    db.select(waAccounts),
    db.select(sites),
    db.select(forms),
    db.select(flows),
    listOpenTasksDueBy(ctx, now),
    listCalendarEvents(ctx, startOfDay(today, timeZone), startOfDay(addDays(today, 1), timeZone)),
  ]);

  const closedStageIds = new Set(
    stageRows.filter((stage) => stage.isWon || stage.isLost).map((stage) => stage.id),
  );
  const openDeals = dealRows.filter((deal) => !closedStageIds.has(deal.stageId));

  const contactNames = new Map(contactRows.map((contact) => [contact.id, contact.name]));

  const recentActivity: RecentActivity[] = activityRows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, RECENT_ACTIVITY_LIMIT)
    .map((activity) => ({
      id: activity.id,
      type: activity.type as ActivityType,
      contactId: activity.contactId,
      contactName: contactNames.get(activity.contactId) ?? activity.contactId,
      createdAt: activity.createdAt,
    }));

  const checklist: OnboardingChecklist = {
    whatsappConnected: waAccountRows.length > 0,
    hasContact: contactRows.length > 0,
    hasDeal: dealRows.length > 0,
    hasQuote: quoteRows.length > 0,
    hasLeadCapture: siteRows.length > 0 || formRows.length > 0,
    hasActiveAutomation: flowRows.some((flow) => flow.status === "active"),
  };

  return {
    stats: {
      openDeals: openDeals.length,
      openDealsValuePyg: openDeals
        .filter((deal) => deal.currency === "PYG")
        .reduce((sum, deal) => sum + deal.value, 0),
      unreadMessages,
      unreadConversations,
      pendingQuotes: quoteRows.filter((quote) => PENDING_QUOTE_STATUSES.has(quote.status))
        .length,
      contacts: contactRows.length,
    },
    checklist,
    recentActivity,
    dueTasks: dueTaskRows.map((task) => ({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      contactId: task.contactId,
      contactName: contactNames.get(task.contactId) ?? task.contactId,
    })),
    todayAppointments: appointmentRows.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      location: event.location,
      contactId: event.contactId,
      contactName: event.contactId ? (contactNames.get(event.contactId) ?? null) : null,
      assignedUserId: event.assignedUserId,
    })),
    onboardingPending: Object.values(checklist).some((done) => !done),
  };
}
