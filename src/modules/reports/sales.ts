import { and, gte, lt, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { contacts, deals, leadSubmissions, messages, stages, tasks } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Sales reporting for the business itself (admin and agente alike — the
// pipeline is shared, §1.2, so the numbers over it are too).
//
// This is lead-to-sale reporting, not web analytics: pageviews and funnels
// are deliberately not in this repo (§1.2 — Umami, self-hosted, separately).
// What the CRM owns is what happened to each lead once it arrived, which is
// the half a rank-and-rent operator actually sells on.
//
// Every read is date-narrowed in SQL and aggregated in memory. A tenant's
// own window is a bounded set — that is what makes this safe without the raw
// `db` access the module boundary (§3.3) does not grant.

export type ReportWindow = { from: Date; to: Date; days: number };

export function reportWindow(days: number, now: Date = new Date()): ReportWindow {
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), to: now, days };
}

export type FunnelCounts = {
  leads: number;
  /** Leads that produced a deal — the ratio that says whether the site is
   * sending work or noise. */
  leadsWithDeal: number;
  contactsCreated: number;
  dealsOpened: number;
  dealsWon: number;
  dealsLost: number;
  wonValue: number;
  currency: string;
};

export type SourceRow = {
  key: string;
  leads: number;
  deals: number;
  won: number;
  wonValue: number;
};

export type AgentRow = {
  userId: string;
  /** Leads whose resulting deal this agent owns — a lead has no owner of its
   *  own until it becomes a deal. */
  leads: number;
  dealsOpened: number;
  dealsWon: number;
  dealsLost: number;
  wonValue: number;
  dealsOpen: number;
  messagesSent: number;
  tasksCompleted: number;
  /** Median first-response time across this agent's own replies — null
   *  when they haven't sent one in the window. */
  responseMedianMinutes: number | null;
};

export type MonthRow = { month: string; won: number; lost: number; wonValue: number };

export type ResponseTimes = {
  /** Conversations in the window that got a reply at all. */
  answered: number;
  /** Inbound-first conversations with no outbound reply after them. */
  unanswered: number;
  medianMinutes: number | null;
  slowestMinutes: number | null;
};

/** One bucket of the response-time distribution (§17.3 P15) — coarser than
 *  the median/slowest pair above, so a rep can see the shape (mostly fast
 *  with one bad weekend vs. uniformly slow) rather than one summary number. */
export type ResponseBucket = "under15m" | "15mTo1h" | "1hTo24h" | "over24h";
export type ResponseBucketRow = { bucket: ResponseBucket; count: number };

export type StageConversionRow = {
  stageId: string;
  name: string;
  position: number;
  /** Deals currently at this stage or further along it (§17.3 P15's
   *  "stage-by-stage conversion") — a cumulative funnel read off each deal's
   *  *current* stage, since no stage-history table exists to reconstruct
   *  which deals ever passed through a stage they have since left. */
  reachedOrPast: number;
};

export type ReportFilters = {
  /** Narrows every table to one pipeline's deals and stages. */
  pipelineId?: string;
  /** Narrows every table to one agent's own numbers — the same report a rep
   *  sees for themself, exactly what they'd get filtering by their own id. */
  agentUserId?: string;
};

export type SalesReport = {
  window: ReportWindow;
  funnel: FunnelCounts;
  bySource: SourceRow[];
  bySite: SourceRow[];
  byAgent: AgentRow[];
  byMonth: MonthRow[];
  response: ResponseTimes;
  responseDistribution: ResponseBucketRow[];
  /** Present only when `filters.pipelineId` is given — computing a funnel
   *  without a pipeline to order stages by would not mean anything. */
  stageConversion: StageConversionRow[];
};

type Utm = { source?: string; campaign?: string };

/** `[from, to)` on any datetime column — the four tables this reads all
 * narrow the same way. */
function inWindow(column: AnyMySqlColumn, window: ReportWindow): SQL {
  return and(gte(column, window.from), lt(column, window.to)) as SQL;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

type ResponseMessage = {
  conversationId: string;
  direction: string;
  createdAt: Date;
  sentByUserId?: string | null;
};

type FirstResponse = { minutes: number; respondedByUserId: string | null } | { minutes: null };

/**
 * First-response time per conversation: from the first inbound message in
 * the window to the first outbound message after it — `null` when nobody
 * answered. The one pass every response-time reading in this module is
 * built from, so "who replied" and "how long it took" never drift apart.
 */
function firstResponsesByConversation(rows: ResponseMessage[]): FirstResponse[] {
  const byConversation = new Map<string, ResponseMessage[]>();
  for (const row of rows) {
    const list = byConversation.get(row.conversationId) ?? [];
    list.push(row);
    byConversation.set(row.conversationId, list);
  }

  const results: FirstResponse[] = [];
  for (const list of byConversation.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const firstInbound = list.find((message) => message.direction === "in");
    if (!firstInbound) continue;

    const reply = list.find(
      (message) =>
        message.direction === "out" &&
        message.createdAt.getTime() >= firstInbound.createdAt.getTime(),
    );
    if (!reply) {
      results.push({ minutes: null });
      continue;
    }
    results.push({
      minutes: (reply.createdAt.getTime() - firstInbound.createdAt.getTime()) / 60000,
      respondedByUserId: reply.sentByUserId ?? null,
    });
  }
  return results;
}

/**
 * First-response time per conversation, aggregated: from the first inbound
 * message in the window to the first outbound message after it.
 *
 * The median rather than the mean, because one holiday weekend would drag an
 * average past the point of meaning anything. Conversations that were never
 * answered are counted separately rather than folded in as a huge number —
 * "eleven unanswered" is the actionable form of that fact.
 */
export function computeResponseTimes(rows: ResponseMessage[]): ResponseTimes {
  const responses = firstResponsesByConversation(rows);
  const minutes = responses
    .map((response) => response.minutes)
    .filter((value): value is number => value !== null);
  const unanswered = responses.length - minutes.length;

  return {
    answered: minutes.length,
    unanswered,
    medianMinutes: median(minutes),
    slowestMinutes: minutes.length > 0 ? Math.max(...minutes) : null,
  };
}

const RESPONSE_BUCKET_ORDER: ResponseBucket[] = ["under15m", "15mTo1h", "1hTo24h", "over24h"];

function bucketOf(minutes: number): ResponseBucket {
  if (minutes < 15) return "under15m";
  if (minutes < 60) return "15mTo1h";
  if (minutes < 24 * 60) return "1hTo24h";
  return "over24h";
}

/** The shape of response times, not just their median (§17.3 P15) —
 *  answered conversations only, bucketed into fixed, always-present rows so
 *  a chart never has to guess which buckets exist. */
export function computeResponseBuckets(rows: ResponseMessage[]): ResponseBucketRow[] {
  const counts = new Map<ResponseBucket, number>();
  for (const response of firstResponsesByConversation(rows)) {
    if (response.minutes === null) continue;
    const bucket = bucketOf(response.minutes);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return RESPONSE_BUCKET_ORDER.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }));
}

/** Median first-response minutes, per replying agent — the per-agent half
 *  of the same first-response computation above. */
function responseMedianByAgent(rows: ResponseMessage[]): Map<string, number> {
  const byAgent = new Map<string, number[]>();
  for (const response of firstResponsesByConversation(rows)) {
    if (response.minutes === null || !response.respondedByUserId) continue;
    const list = byAgent.get(response.respondedByUserId) ?? [];
    list.push(response.minutes);
    byAgent.set(response.respondedByUserId, list);
  }

  const result = new Map<string, number>();
  for (const [userId, minutes] of byAgent) {
    const value = median(minutes);
    if (value !== null) result.set(userId, value);
  }
  return result;
}

/**
 * Cumulative stage funnel for one pipeline (§17.3 P15): for each stage,
 * ordered by position, how many deals are currently at that stage or one
 * further along — read off each deal's *current* stage, since no
 * stage-history table exists to ask "did this deal ever reach stage N".
 */
export function computeStageFunnel(
  dealRows: (typeof deals.$inferSelect)[],
  stageRows: (typeof stages.$inferSelect)[],
  pipelineId: string,
): StageConversionRow[] {
  const pipelineStages = stageRows
    .filter((stage) => stage.pipelineId === pipelineId)
    .sort((a, b) => a.position - b.position);

  const countAtPosition = new Map<number, number>();
  for (const deal of dealRows) {
    if (deal.pipelineId !== pipelineId) continue;
    const stage = pipelineStages.find((candidate) => candidate.id === deal.stageId);
    if (!stage) continue;
    countAtPosition.set(stage.position, (countAtPosition.get(stage.position) ?? 0) + 1);
  }

  // Cumulative from the end: "reached stage N or past it" sums this stage's
  // own count with every later stage's.
  let runningTotal = 0;
  const totalsByPosition = new Map<number, number>();
  for (let i = pipelineStages.length - 1; i >= 0; i--) {
    runningTotal += countAtPosition.get(pipelineStages[i]!.position) ?? 0;
    totalsByPosition.set(pipelineStages[i]!.position, runningTotal);
  }

  return pipelineStages.map((stage) => ({
    stageId: stage.id,
    name: stage.name,
    position: stage.position,
    reachedOrPast: totalsByPosition.get(stage.position) ?? 0,
  }));
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The same length of time, immediately before `window.from` — the
 *  comparison column every P15 table carries (§17.3 P15). */
export function previousWindow(window: ReportWindow): ReportWindow {
  const spanMs = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - spanMs), to: window.from, days: window.days };
}

export async function getSalesReport(
  ctx: TenantContext,
  window: ReportWindow,
  filters: ReportFilters = {},
): Promise<SalesReport> {
  const db = tenantDb(ctx);

  const [leadRows, contactRows, allDealRows, stageRows, messageRows, taskRows] = await Promise.all([
    db.select(leadSubmissions, inWindow(leadSubmissions.createdAt, window)),
    db.select(contacts, inWindow(contacts.createdAt, window)),
    // Deals are read on *creation* in the window and again on closure below —
    // a deal opened in March and won in April belongs to March's "opened" and
    // April's "won", which is the only reading that makes a monthly series
    // add up.
    db.select(deals),
    db.select(stages),
    db.select(messages, inWindow(messages.createdAt, window)),
    db.select(tasks, inWindow(tasks.dueAt, window)),
  ]);

  // Both filters narrow the same one array; everything below reads only
  // `dealRows`, so a pipeline or agent filter reaches every table (funnel,
  // sources, agents, months, the stage funnel) without a second pass.
  const dealRows = allDealRows.filter(
    (deal) =>
      (!filters.pipelineId || deal.pipelineId === filters.pipelineId) &&
      (!filters.agentUserId || deal.assignedUserId === filters.agentUserId),
  );

  const wonStages = new Set(stageRows.filter((stage) => stage.isWon).map((stage) => stage.id));
  const lostStages = new Set(stageRows.filter((stage) => stage.isLost).map((stage) => stage.id));

  const openedInWindow = dealRows.filter(
    (deal) => deal.createdAt >= window.from && deal.createdAt < window.to,
  );
  const closedInWindow = dealRows.filter(
    (deal) => deal.closedAt !== null && deal.closedAt >= window.from && deal.closedAt < window.to,
  );
  const wonInWindow = closedInWindow.filter((deal) => wonStages.has(deal.stageId));
  const lostInWindow = closedInWindow.filter((deal) => lostStages.has(deal.stageId));

  const dealsById = new Map(dealRows.map((deal) => [deal.id, deal]));

  /** Leads grouped by whatever key the caller picks, carrying the deal they
   * produced so conversion is read from the same row rather than joined
   * again downstream. */
  function group(pick: (row: (typeof leadRows)[number]) => string | null | undefined): SourceRow[] {
    const rows = new Map<string, SourceRow>();
    for (const lead of leadRows) {
      const key = pick(lead) || "—";
      const row = rows.get(key) ?? { key, leads: 0, deals: 0, won: 0, wonValue: 0 };
      row.leads += 1;

      const deal = lead.dealId ? dealsById.get(lead.dealId) : undefined;
      if (deal) {
        row.deals += 1;
        if (wonStages.has(deal.stageId)) {
          row.won += 1;
          row.wonValue += deal.value;
        }
      }
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.leads - a.leads);
  }

  const agents = new Map<string, AgentRow>();
  const agentRow = (userId: string) => {
    const row = agents.get(userId) ?? {
      userId,
      leads: 0,
      dealsOpened: 0,
      dealsWon: 0,
      dealsLost: 0,
      wonValue: 0,
      dealsOpen: 0,
      messagesSent: 0,
      tasksCompleted: 0,
      responseMedianMinutes: null,
    };
    agents.set(userId, row);
    return row;
  };

  for (const lead of leadRows) {
    const deal = lead.dealId ? dealsById.get(lead.dealId) : undefined;
    if (deal?.assignedUserId) agentRow(deal.assignedUserId).leads += 1;
  }
  for (const deal of openedInWindow) {
    if (deal.assignedUserId) agentRow(deal.assignedUserId).dealsOpened += 1;
  }
  for (const deal of wonInWindow) {
    if (!deal.assignedUserId) continue;
    const row = agentRow(deal.assignedUserId);
    row.dealsWon += 1;
    row.wonValue += deal.value;
  }
  for (const deal of lostInWindow) {
    if (deal.assignedUserId) agentRow(deal.assignedUserId).dealsLost += 1;
  }
  for (const deal of dealRows) {
    if (!deal.assignedUserId) continue;
    if (wonStages.has(deal.stageId) || lostStages.has(deal.stageId)) continue;
    agentRow(deal.assignedUserId).dealsOpen += 1;
  }
  for (const message of messageRows) {
    if (message.direction !== "out" || !message.sentByUserId) continue;
    agentRow(message.sentByUserId).messagesSent += 1;
  }
  for (const task of taskRows) {
    if (!task.completedAt || !task.assignedUserId) continue;
    if (task.completedAt < window.from || task.completedAt >= window.to) continue;
    agentRow(task.assignedUserId).tasksCompleted += 1;
  }
  for (const [userId, minutes] of responseMedianByAgent(messageRows)) {
    if (agents.has(userId)) agentRow(userId).responseMedianMinutes = minutes;
  }

  const months = new Map<string, MonthRow>();
  for (const deal of closedInWindow) {
    const key = monthKey(deal.closedAt!);
    const row = months.get(key) ?? { month: key, won: 0, lost: 0, wonValue: 0 };
    if (wonStages.has(deal.stageId)) {
      row.won += 1;
      row.wonValue += deal.value;
    } else if (lostStages.has(deal.stageId)) {
      row.lost += 1;
    }
    months.set(key, row);
  }

  return {
    window,
    funnel: {
      leads: leadRows.length,
      leadsWithDeal: leadRows.filter((lead) => lead.dealId).length,
      contactsCreated: contactRows.length,
      dealsOpened: openedInWindow.length,
      dealsWon: wonInWindow.length,
      dealsLost: lostInWindow.length,
      wonValue: wonInWindow.reduce((sum, deal) => sum + deal.value, 0),
      // Phase 1 is single-currency per tenant in practice; the first won deal
      // names it, and PYG is the default everywhere else (§2.3).
      currency: wonInWindow[0]?.currency ?? "PYG",
    },
    bySource: group((lead) => ((lead.utm ?? {}) as Utm).source),
    bySite: group((lead) => lead.siteId),
    byAgent: [...agents.values()].sort((a, b) => b.wonValue - a.wonValue),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    response: computeResponseTimes(messageRows),
    responseDistribution: computeResponseBuckets(messageRows),
    stageConversion: filters.pipelineId
      ? computeStageFunnel(allDealRows, stageRows, filters.pipelineId)
      : [],
  };
}
