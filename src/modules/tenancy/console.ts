import { count, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, leadSubmissions, sites, tenantMemberships, tenants } from "@/db/schema";

// The console's business list (superadmin /tenants): one row per business
// with what an operator running ~50 sites needs to recognise it and see
// whether it works — its domains, who is in it, how big it is and when a lead
// last arrived. Cross-tenant by definition, so raw `db` like platform-stats;
// every caller sits behind requireSuperadminContext.

export type ConsoleTenantRow = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "trial";
  createdAt: Date;
  sites: Array<{ domain: string | null; slug: string; isActive: boolean }>;
  members: number;
  contacts: number;
  lastLeadAt: Date | null;
};

export async function listTenantsForConsole(): Promise<ConsoleTenantRow[]> {
  const [tenantRows, siteRows, memberRows, contactRows, leadRows] = await Promise.all([
    db.select().from(tenants),
    db
      .select({
        tenantId: sites.tenantId,
        domain: sites.domain,
        slug: sites.slug,
        isActive: sites.isActive,
      })
      .from(sites),
    db
      .select({ tenantId: tenantMemberships.tenantId, value: count() })
      .from(tenantMemberships)
      .groupBy(tenantMemberships.tenantId),
    db
      .select({ tenantId: contacts.tenantId, value: count() })
      .from(contacts)
      .groupBy(contacts.tenantId),
    db
      .select({
        tenantId: leadSubmissions.tenantId,
        value: sql<string>`max(${leadSubmissions.createdAt})`,
      })
      .from(leadSubmissions)
      .groupBy(leadSubmissions.tenantId),
  ]);

  const byTenant = <T extends { tenantId: string; value: unknown }>(rows: T[]) =>
    new Map(rows.map((row) => [row.tenantId, row.value]));
  const membersBy = byTenant(memberRows);
  const contactsBy = byTenant(contactRows);
  const lastLeadBy = byTenant(leadRows);

  const sitesBy = new Map<string, ConsoleTenantRow["sites"]>();
  for (const site of siteRows) {
    const list = sitesBy.get(site.tenantId) ?? [];
    list.push({ domain: site.domain, slug: site.slug, isActive: site.isActive });
    sitesBy.set(site.tenantId, list);
  }

  return tenantRows
    .map((tenant) => {
      const last = lastLeadBy.get(tenant.id);
      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        createdAt: tenant.createdAt,
        sites: sitesBy.get(tenant.id) ?? [],
        members: Number(membersBy.get(tenant.id) ?? 0),
        contacts: Number(contactsBy.get(tenant.id) ?? 0),
        lastLeadAt: last ? new Date(last as string) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
