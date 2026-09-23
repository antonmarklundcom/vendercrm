import { count, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { siteApiKeys, siteIngestHealth, sites, tenants } from "@/db/schema";
import { siteHealthStatus, type SiteHealthStatus } from "@/modules/sites/health";

// Every site on the platform in one list, for the console's /platform-sites:
// the view an operator running dozens of lead forms needs to see which ones
// are broken or have gone quiet, and to issue keys for many at once.
// Cross-tenant by definition, so raw `db` like console.ts; every caller sits
// behind requireSuperadminContext.

export type PlatformSiteRow = {
  siteId: string;
  tenantId: string;
  tenantName: string;
  domain: string | null;
  slug: string;
  isActive: boolean;
  health: SiteHealthStatus;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorReason: string | null;
  activeKeys: number;
  lastKeyUsedAt: Date | null;
  createdAt: Date;
};

export async function listPlatformSites(): Promise<PlatformSiteRow[]> {
  const [siteRows, tenantRows, healthRows, keyRows] = await Promise.all([
    db.select().from(sites),
    db.select({ id: tenants.id, name: tenants.name }).from(tenants),
    db.select().from(siteIngestHealth),
    db
      .select({
        siteId: siteApiKeys.siteId,
        active: count(),
        lastUsed: sql<string | null>`max(${siteApiKeys.lastUsedAt})`,
      })
      .from(siteApiKeys)
      .where(isNull(siteApiKeys.revokedAt))
      .groupBy(siteApiKeys.siteId),
  ]);

  const tenantName = new Map(tenantRows.map((t) => [t.id, t.name]));
  const healthBy = new Map(healthRows.map((h) => [h.siteId, h]));
  const keysBy = new Map(keyRows.map((k) => [k.siteId, k]));

  return siteRows
    .map((site) => {
      const health = healthBy.get(site.id);
      const keys = keysBy.get(site.id);
      return {
        siteId: site.id,
        tenantId: site.tenantId,
        tenantName: tenantName.get(site.tenantId) ?? "",
        domain: site.domain,
        slug: site.slug,
        isActive: site.isActive,
        health: siteHealthStatus(health),
        lastSuccessAt: health?.lastSuccessAt ?? null,
        lastErrorAt: health?.lastErrorAt ?? null,
        lastErrorReason: health?.lastErrorReason ?? null,
        activeKeys: Number(keys?.active ?? 0),
        lastKeyUsedAt: keys?.lastUsed ? new Date(keys.lastUsed) : null,
        createdAt: site.createdAt,
      };
    })
    .sort((a, b) => (a.domain ?? a.slug).localeCompare(b.domain ?? b.slug));
}

/** Which business each site belongs to — the one thing a bulk action needs
 * before it can open a tenant context per site. Unknown ids are dropped. */
export async function resolveSiteTenants(
  siteIds: string[],
): Promise<Array<{ siteId: string; tenantId: string; domain: string | null; slug: string; tenantName: string }>> {
  if (siteIds.length === 0) return [];
  const rows = await db
    .select({
      siteId: sites.id,
      tenantId: sites.tenantId,
      domain: sites.domain,
      slug: sites.slug,
      tenantName: tenants.name,
    })
    .from(sites)
    .innerJoin(tenants, sql`${tenants.id} = ${sites.tenantId}`)
    .where(inArray(sites.id, siteIds));
  return rows;
}
