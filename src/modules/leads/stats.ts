import { leadSubmissions } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { filterBySiteScope } from "@/modules/access/scope";

// Per-site lead reporting (PLAN.md §5.1, 1E exit criteria: "leads filterable
// by site and campaign"). Deliberately small: traffic analytics is not built
// here (§1.2 — Umami handles pageviews/funnels), only lead-level counts the
// CRM already owns.

export type LeadStatsFilters = {
  siteId?: string;
  campaign?: string;
  since?: Date;
};

type Utm = { source?: string; campaign?: string };

export async function listLeadSubmissions(ctx: TenantContext, filters: LeadStatsFilters = {}) {
  const rows = filterBySiteScope(
    ctx,
    await tenantDb(ctx).select(leadSubmissions),
    (row) => row.siteId,
  );

  return rows
    .filter((row) => {
      if (filters.siteId && row.siteId !== filters.siteId) return false;
      if (filters.since && row.createdAt < filters.since) return false;
      if (filters.campaign) {
        const utm = (row.utm ?? {}) as Utm;
        if (utm.campaign !== filters.campaign) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type LeadCountBucket = { key: string; count: number };

function countBy(
  rows: Array<Record<string, unknown>>,
  pick: (row: Record<string, unknown>) => string | null | undefined,
): LeadCountBucket[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row) || "—";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/** Lead counts grouped by site, campaign and source, over an optional window. */
export async function getLeadStats(ctx: TenantContext, filters: LeadStatsFilters = {}) {
  const rows = await listLeadSubmissions(ctx, filters);

  return {
    total: rows.length,
    withDeal: rows.filter((row) => row.dealId).length,
    bySite: countBy(rows, (row) => row.siteId as string | null),
    byCampaign: countBy(rows, (row) => ((row.utm ?? {}) as Utm).campaign),
    bySource: countBy(rows, (row) => ((row.utm ?? {}) as Utm).source),
  };
}
