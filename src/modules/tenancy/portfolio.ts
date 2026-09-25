import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, max, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  chatConversations,
  contacts,
  conversations,
  deals,
  leadSubmissions,
  stages,
  tasks,
  waAccounts,
} from "@/db/schema";
import type { TenantRole } from "./context";
import { listMembershipsForUser } from "./memberships";
import { priorityScore } from "./portfolio-score";
import { computeAccessStatus, type AccessStatus } from "./subscriptions";

// "All my businesses" (/businesses): one screen for the person who runs more
// than one — an owner with ten shops, or the operator with fifty lead-gen
// sites — to see which business needs them first and read every inbox at once.
//
// Cross-tenant by nature, so it lives in the tenancy module and reads `db`
// directly — but never over a tenant id the browser supplied. Every read here
// starts from `listMembershipsForUser(userId)`, the same live, ban-aware grant
// list the switcher uses, and is filtered to exactly those tenant ids. A
// person therefore sees the businesses they could already switch into, and
// nothing else. Aggregates stay in SQL (grouped by tenant), so a hundred
// businesses cost the same handful of queries as two.

export const PORTFOLIO_LEAD_WINDOW_DAYS = 7;

export type PortfolioBusiness = {
  tenantId: string;
  name: string;
  role: TenantRole;
  access: AccessStatus;
  /** WhatsApp + web-chat conversations with at least one unread message. */
  unreadConversations: number;
  /** Unread messages across those conversations. */
  unreadMessages: number;
  /** Open conversations nobody has been assigned to. */
  unassignedConversations: number;
  leads: number;
  /** Leads in the window of the same length right before, for the trend. */
  leadsPrevious: number;
  openDeals: number;
  /** Sum of open deal values, guaraníes only (see platform-stats.ts). */
  openDealsValue: number;
  overdueTasks: number;
  whatsappInError: boolean;
  /** Latest message a customer sent on any channel; null = never. */
  lastInboundAt: Date | null;
  lastLeadAt: Date | null;
  /** Higher = look at this one first. See `priorityScore`. */
  priority: number;
};

export type PortfolioMessage = {
  tenantId: string;
  tenantName: string;
  channel: "whatsapp" | "webchat";
  conversationId: string;
  contactName: string | null;
  contactPhone: string | null;
  preview: string | null;
  /** Message type of the last message, so a voice note can say so. */
  previewType: string | null;
  previewDirection: "in" | "out" | null;
  unreadCount: number;
  lastMessageAt: Date | null;
};

function num(value: unknown): number {
  return Number(value ?? 0);
}

function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Every business `userId` can act in, with the numbers to prioritise them. */
export async function listPortfolio(
  userId: string,
  now: Date = new Date(),
): Promise<PortfolioBusiness[]> {
  const memberships = await listMembershipsForUser(userId);
  if (memberships.length === 0) return [];

  const ids = memberships.map((m) => m.tenant.id);
  const since = new Date(now.getTime() - PORTFOLIO_LEAD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const previousSince = new Date(since.getTime() - PORTFOLIO_LEAD_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    waRows,
    chatRows,
    leadRows,
    previousLeadRows,
    lastLeadRows,
    dealRows,
    taskRows,
    waErrorRows,
    access,
  ] = await Promise.all([
    db
      .select({
        tenantId: conversations.tenantId,
        unreadConversations: sql<string>`sum(case when ${conversations.unreadCount} > 0 then 1 else 0 end)`,
        unreadMessages: sql<string>`coalesce(sum(${conversations.unreadCount}), 0)`,
        unassigned: sql<string>`sum(case when ${conversations.status} = 'open' and ${conversations.assignedUserId} is null and ${conversations.unreadCount} > 0 then 1 else 0 end)`,
        lastInboundAt: max(conversations.lastInboundAt),
      })
      .from(conversations)
      .where(inArray(conversations.tenantId, ids))
      .groupBy(conversations.tenantId),
    db
      .select({
        tenantId: chatConversations.tenantId,
        unreadConversations: sql<string>`sum(case when ${chatConversations.unreadCount} > 0 then 1 else 0 end)`,
        unreadMessages: sql<string>`coalesce(sum(${chatConversations.unreadCount}), 0)`,
        unassigned: sql<string>`sum(case when ${chatConversations.assignedUserId} is null and ${chatConversations.unreadCount} > 0 then 1 else 0 end)`,
        lastInboundAt: max(chatConversations.lastVisitorMessageAt),
      })
      .from(chatConversations)
      .where(and(inArray(chatConversations.tenantId, ids), eq(chatConversations.status, "open")))
      .groupBy(chatConversations.tenantId),
    db
      .select({ tenantId: leadSubmissions.tenantId, value: count() })
      .from(leadSubmissions)
      .where(and(inArray(leadSubmissions.tenantId, ids), gte(leadSubmissions.createdAt, since)))
      .groupBy(leadSubmissions.tenantId),
    db
      .select({ tenantId: leadSubmissions.tenantId, value: count() })
      .from(leadSubmissions)
      .where(
        and(
          inArray(leadSubmissions.tenantId, ids),
          gte(leadSubmissions.createdAt, previousSince),
          lt(leadSubmissions.createdAt, since),
        ),
      )
      .groupBy(leadSubmissions.tenantId),
    db
      .select({ tenantId: leadSubmissions.tenantId, value: max(leadSubmissions.createdAt) })
      .from(leadSubmissions)
      .where(inArray(leadSubmissions.tenantId, ids))
      .groupBy(leadSubmissions.tenantId),
    db
      .select({
        tenantId: deals.tenantId,
        value: count(),
        amount: sql<string>`coalesce(sum(case when ${deals.currency} = 'PYG' then ${deals.value} else 0 end), 0)`,
      })
      .from(deals)
      .innerJoin(stages, eq(stages.id, deals.stageId))
      .where(and(inArray(deals.tenantId, ids), eq(stages.isWon, false), eq(stages.isLost, false)))
      .groupBy(deals.tenantId),
    db
      .select({ tenantId: tasks.tenantId, value: count() })
      .from(tasks)
      .where(and(inArray(tasks.tenantId, ids), isNull(tasks.completedAt), lte(tasks.dueAt, now)))
      .groupBy(tasks.tenantId),
    db
      .select({ tenantId: waAccounts.tenantId, value: count() })
      .from(waAccounts)
      .where(and(inArray(waAccounts.tenantId, ids), eq(waAccounts.status, "error")))
      .groupBy(waAccounts.tenantId),
    Promise.all(memberships.map((m) => computeAccessStatus(m.tenant.id, m.tenant.status))),
  ]);

  const by = <T extends { tenantId: string }>(rows: T[]) => new Map(rows.map((row) => [row.tenantId, row]));
  const wa = by(waRows);
  const chat = by(chatRows);
  const leadsBy = by(leadRows);
  const previousBy = by(previousLeadRows);
  const lastLeadBy = by(lastLeadRows);
  const dealsBy = by(dealRows);
  const tasksBy = by(taskRows);
  const waErrorBy = by(waErrorRows);

  return memberships
    .map(({ membership, tenant }, index) => {
      const w = wa.get(tenant.id);
      const c = chat.get(tenant.id);
      const business: Omit<PortfolioBusiness, "priority"> = {
        tenantId: tenant.id,
        name: tenant.name,
        role: membership.role,
        access: access[index],
        unreadConversations: num(w?.unreadConversations) + num(c?.unreadConversations),
        unreadMessages: num(w?.unreadMessages) + num(c?.unreadMessages),
        unassignedConversations: num(w?.unassigned) + num(c?.unassigned),
        leads: num(leadsBy.get(tenant.id)?.value),
        leadsPrevious: num(previousBy.get(tenant.id)?.value),
        openDeals: num(dealsBy.get(tenant.id)?.value),
        openDealsValue: num(dealsBy.get(tenant.id)?.amount),
        overdueTasks: num(tasksBy.get(tenant.id)?.value),
        whatsappInError: num(waErrorBy.get(tenant.id)?.value) > 0,
        lastInboundAt: later(date(w?.lastInboundAt), date(c?.lastInboundAt)),
        lastLeadAt: date(lastLeadBy.get(tenant.id)?.value),
      };
      return { ...business, priority: priorityScore(business) };
    });
}

/**
 * The newest conversations across every business the user belongs to — the
 * unified inbox. `unreadOnly` narrows to conversations still waiting on a
 * reply. Each row carries its business so the page can say whose it is.
 */
export async function listPortfolioMessages(
  userId: string,
  options: { unreadOnly: boolean; limit?: number },
): Promise<PortfolioMessage[]> {
  const memberships = await listMembershipsForUser(userId);
  if (memberships.length === 0) return [];

  const ids = memberships.map((m) => m.tenant.id);
  const nameById = new Map(memberships.map((m) => [m.tenant.id, m.tenant.name]));
  const limit = options.limit ?? 50;

  const [waRows, chatRows] = await Promise.all([
    db
      .select({
        tenantId: conversations.tenantId,
        conversationId: conversations.id,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt,
        // Correlated subqueries for the one newest message per row: bounded
        // by `limit`, and each hits messages_conversation_id_idx.
        preview: sql<string | null>`(select coalesce(m.body, m.transcript) from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
        previewType: sql<string | null>`(select m.type from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
        previewDirection: sql<"in" | "out" | null>`(select m.direction from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
      })
      .from(conversations)
      .leftJoin(
        contacts,
        and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, conversations.tenantId)),
      )
      .where(
        and(
          inArray(conversations.tenantId, ids),
          isNotNull(conversations.lastMessageAt),
          options.unreadOnly ? gt(conversations.unreadCount, 0) : undefined,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit),
    db
      .select({
        tenantId: chatConversations.tenantId,
        conversationId: chatConversations.id,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        unreadCount: chatConversations.unreadCount,
        lastMessageAt: chatConversations.lastMessageAt,
        preview: sql<string | null>`(select m.body from chat_messages m where m.chat_conversation_id = ${chatConversations.id} order by m.created_at desc limit 1)`,
        previewDirection: sql<"in" | "out" | null>`(select m.direction from chat_messages m where m.chat_conversation_id = ${chatConversations.id} order by m.created_at desc limit 1)`,
      })
      .from(chatConversations)
      .leftJoin(
        contacts,
        and(eq(contacts.id, chatConversations.contactId), eq(contacts.tenantId, chatConversations.tenantId)),
      )
      .where(
        and(
          inArray(chatConversations.tenantId, ids),
          eq(chatConversations.status, "open"),
          isNotNull(chatConversations.lastMessageAt),
          options.unreadOnly ? gt(chatConversations.unreadCount, 0) : undefined,
        ),
      )
      .orderBy(desc(chatConversations.lastMessageAt))
      .limit(limit),
  ]);

  const rows: PortfolioMessage[] = [
    ...waRows.map((row) => ({
      ...row,
      channel: "whatsapp" as const,
      tenantName: nameById.get(row.tenantId) ?? "",
      lastMessageAt: date(row.lastMessageAt),
    })),
    ...chatRows.map((row) => ({
      ...row,
      channel: "webchat" as const,
      previewType: "text",
      tenantName: nameById.get(row.tenantId) ?? "",
      lastMessageAt: date(row.lastMessageAt),
    })),
  ];

  return rows
    .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0))
    .slice(0, limit);
}

/**
 * Whether a conversation id really belongs to `tenantId` — checked before the
 * overview's "open this conversation" jumps there, so a stale or forged id
 * lands on the inbox list instead of a 404 (or a probe).
 */
export async function conversationBelongsTo(
  tenantId: string,
  channel: "whatsapp" | "webchat",
  conversationId: string,
): Promise<boolean> {
  const table = channel === "whatsapp" ? conversations : chatConversations;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, conversationId), eq(table.tenantId, tenantId)));
  return Boolean(row);
}
