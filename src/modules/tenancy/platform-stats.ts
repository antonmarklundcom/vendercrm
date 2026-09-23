import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  contacts,
  deals,
  leadSubmissions,
  messages,
  plans,
  quotes,
  stages,
  subscriptions,
  tenantMemberships,
  tenants,
  users,
  waAccounts,
} from "@/db/schema";

// The platform's own numbers, for the superadmin console (PLAN.md §3.2:
// "platform WhatsApp health dashboard" was the only cross-tenant view that
// existed; how the business itself is doing was not visible anywhere).
//
// Cross-tenant by definition, so it reads `db` directly and never tenantDb —
// there is no TenantContext to scope by, which is the whole point. Every
// caller sits behind requireSuperadminContext.
//
// Counts are aggregates in SQL rather than rows in memory: this page grows
// with the platform, and "select every message ever" is how a console becomes
// the slowest page in the product.

export type PlatformWindow = { days: number; since: Date };

export function windowOf(days: number, now: Date = new Date()): PlatformWindow {
  return { days, since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) };
}

async function scalar(query: Promise<Array<{ value: number }>>): Promise<number> {
  const [row] = await query;
  return Number(row?.value ?? 0);
}

export type PlatformTotals = {
  tenants: number;
  tenantsByStatus: Record<string, number>;
  users: number;
  superadmins: number;
  memberships: number;
  /** People who can reach more than one business — the operator's own case,
   * and the number that says whether the feature is being used. */
  multiBusinessUsers: number;
  contacts: number;
  openDeals: number;
  whatsappAccounts: number;
  whatsappAccountsInError: number;
};

export type PlatformActivity = {
  days: number;
  contactsCreated: number;
  dealsCreated: number;
  dealsWon: number;
  messagesIn: number;
  messagesOut: number;
  leads: number;
  quotesSent: number;
};

export type TenantActivityRow = {
  tenantId: string;
  tenantName: string;
  status: string;
  contacts: number;
  leads: number;
  messages: number;
  /** Null when the tenant has never had a message — a real state, not a zero. */
  lastMessageAt: Date | null;
};

export type ExpiringSubscription = {
  tenantId: string;
  tenantName: string;
  expiresAt: Date;
  status: string;
};

export async function getPlatformTotals(): Promise<PlatformTotals> {
  const [
    tenantRows,
    userCount,
    superadminCount,
    membershipCount,
    multiBusiness,
    contactCount,
    openDealCount,
    waRows,
  ] = await Promise.all([
    db.select({ status: tenants.status, value: count() }).from(tenants).groupBy(tenants.status),
    scalar(db.select({ value: count() }).from(users)),
    scalar(db.select({ value: count() }).from(users).where(eq(users.isSuperadmin, true))),
    scalar(db.select({ value: count() }).from(tenantMemberships)),
    // One row per user with two or more memberships; the outer count is how
    // many such users there are.
    db
      .select({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .groupBy(tenantMemberships.userId)
      .having(sql`count(*) > 1`),
    scalar(db.select({ value: count() }).from(contacts)),
    scalar(
      db
        .select({ value: count() })
        .from(deals)
        .innerJoin(stages, eq(stages.id, deals.stageId))
        .where(and(eq(stages.isWon, false), eq(stages.isLost, false))),
    ),
    db.select({ status: waAccounts.status, value: count() }).from(waAccounts).groupBy(waAccounts.status),
  ]);

  const tenantsByStatus = Object.fromEntries(
    tenantRows.map((row) => [row.status, Number(row.value)]),
  );

  return {
    tenants: tenantRows.reduce((sum, row) => sum + Number(row.value), 0),
    tenantsByStatus,
    users: userCount,
    superadmins: superadminCount,
    memberships: membershipCount,
    multiBusinessUsers: multiBusiness.length,
    contacts: contactCount,
    openDeals: openDealCount,
    whatsappAccounts: waRows.reduce((sum, row) => sum + Number(row.value), 0),
    whatsappAccountsInError: waRows
      .filter((row) => row.status === "error")
      .reduce((sum, row) => sum + Number(row.value), 0),
  };
}

export async function getPlatformActivity(window: PlatformWindow): Promise<PlatformActivity> {
  const [contactsCreated, dealsCreated, dealsWon, messagesIn, messagesOut, leads, quotesSent] =
    await Promise.all([
      scalar(
        db.select({ value: count() }).from(contacts).where(gte(contacts.createdAt, window.since)),
      ),
      scalar(db.select({ value: count() }).from(deals).where(gte(deals.createdAt, window.since))),
      // "Won" is a property of the stage the deal sits in (§4), not a column
      // on the deal — hence the join rather than a status filter.
      scalar(
        db
          .select({ value: count() })
          .from(deals)
          .innerJoin(stages, eq(stages.id, deals.stageId))
          .where(
            and(
              isNotNull(deals.closedAt),
              gte(deals.closedAt, window.since),
              eq(stages.isWon, true),
            ),
          ),
      ),
      scalar(
        db
          .select({ value: count() })
          .from(messages)
          .where(and(eq(messages.direction, "in"), gte(messages.createdAt, window.since))),
      ),
      scalar(
        db
          .select({ value: count() })
          .from(messages)
          .where(and(eq(messages.direction, "out"), gte(messages.createdAt, window.since))),
      ),
      scalar(
        db
          .select({ value: count() })
          .from(leadSubmissions)
          .where(gte(leadSubmissions.createdAt, window.since)),
      ),
      scalar(db.select({ value: count() }).from(quotes).where(gte(quotes.createdAt, window.since))),
    ]);

  return {
    days: window.days,
    contactsCreated,
    dealsCreated,
    dealsWon,
    messagesIn,
    messagesOut,
    leads,
    quotesSent,
  };
}

/**
 * Per-tenant activity in the window, busiest first — which businesses are
 * actually using what they pay for, and which have gone quiet. The quiet ones
 * are the reason this exists: a tenant with no messages for three weeks is a
 * churn conversation, not a statistic.
 */
export async function listTenantActivity(window: PlatformWindow): Promise<TenantActivityRow[]> {
  const [tenantRows, contactRows, leadRows, messageRows, lastMessageRows] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.name, status: tenants.status }).from(tenants),
    db
      .select({ tenantId: contacts.tenantId, value: count() })
      .from(contacts)
      .where(gte(contacts.createdAt, window.since))
      .groupBy(contacts.tenantId),
    db
      .select({ tenantId: leadSubmissions.tenantId, value: count() })
      .from(leadSubmissions)
      .where(gte(leadSubmissions.createdAt, window.since))
      .groupBy(leadSubmissions.tenantId),
    db
      .select({ tenantId: messages.tenantId, value: count() })
      .from(messages)
      .where(gte(messages.createdAt, window.since))
      .groupBy(messages.tenantId),
    db
      .select({ tenantId: messages.tenantId, value: sql<string>`max(${messages.createdAt})` })
      .from(messages)
      .groupBy(messages.tenantId),
  ]);

  const byTenant = <T extends { tenantId: string; value: unknown }>(rows: T[]) =>
    new Map(rows.map((row) => [row.tenantId, row.value]));

  const contactsBy = byTenant(contactRows);
  const leadsBy = byTenant(leadRows);
  const messagesBy = byTenant(messageRows);
  const lastMessageBy = byTenant(lastMessageRows);

  return tenantRows
    .map((tenant) => {
      const last = lastMessageBy.get(tenant.id);
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        status: tenant.status,
        contacts: Number(contactsBy.get(tenant.id) ?? 0),
        leads: Number(leadsBy.get(tenant.id) ?? 0),
        messages: Number(messagesBy.get(tenant.id) ?? 0),
        lastMessageAt: last ? new Date(last as string) : null,
      };
    })
    .sort((a, b) => b.messages + b.leads - (a.messages + a.leads));
}

/** A plan's price normalised to what one month of it is worth — plans are
 * prepaid for 3, 6 or 12 months (schema/tenancy.ts), so the sticker price
 * alone overstates a month's revenue by 3x-12x. Exported on its own so the
 * normalisation is unit-testable without a database. */
export function monthlyPrice(price: number, durationMonths: number): number {
  return price / durationMonths;
}

export type RevenueTotals = {
  /** Sum of every active subscription's plan price, normalised to a month
   * (price / durationMonths — plans are prepaid for 3, 6 or 12 months, so a
   * plan's price alone overstates what a month of it is worth). */
  monthlyRevenue: number;
  /** Businesses with a currently-active subscription — "active" meaning not
   * yet past its expiry, the same test computeAccessStatus uses for the
   * "active" access status. */
  payingTenants: number;
};

/**
 * Expected monthly revenue from every tenant's *latest* subscription that
 * hasn't expired yet — one row per tenant, exactly like
 * getLatestSubscriptionForTenant, so a renewed subscription doesn't get
 * double-counted against its own superseded row.
 */
export async function getMonthlyRevenue(): Promise<RevenueTotals> {
  const rows = await db
    .select({
      tenantId: subscriptions.tenantId,
      startsAt: subscriptions.startsAt,
      expiresAt: subscriptions.expiresAt,
      price: plans.price,
      durationMonths: plans.durationMonths,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId));

  const latestByTenant = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = latestByTenant.get(row.tenantId);
    if (!current || row.startsAt > current.startsAt) {
      latestByTenant.set(row.tenantId, row);
    }
  }

  const now = new Date();
  let monthlyRevenue = 0;
  let payingTenants = 0;
  for (const row of latestByTenant.values()) {
    if (row.expiresAt <= now) continue;
    payingTenants += 1;
    monthlyRevenue += monthlyPrice(row.price, row.durationMonths);
  }

  return { monthlyRevenue: Math.round(monthlyRevenue), payingTenants };
}

/** Subscriptions expiring inside `days`, soonest first — the list the manual
 * billing model (§1.2) turns into an actual reminder. */
export async function listExpiringSubscriptions(days = 30): Promise<ExpiringSubscription[]> {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      tenantId: subscriptions.tenantId,
      tenantName: tenants.name,
      expiresAt: subscriptions.expiresAt,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(sql`${subscriptions.expiresAt} <= ${until}`);

  return rows
    .map((row) => ({ ...row, expiresAt: new Date(row.expiresAt) }))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}
