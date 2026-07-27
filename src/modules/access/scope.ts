import { inArray } from "drizzle-orm";
import { contacts } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Applying the site scope (PLAN.md §5.2). Tenant scoping is auto-injected by
// tenantDb; site scoping can't be, because only some tables carry a site
// dimension. These helpers are the sanctioned way to apply it, so the rule
// lives in one file instead of being re-derived at each call site.

export function isUnrestricted(ctx: TenantContext): boolean {
  return ctx.siteScope === null;
}

/** True if the caller may see data belonging to this site. */
export function siteInScope(ctx: TenantContext, siteId: string | null): boolean {
  if (ctx.siteScope === null) return true;
  if (!siteId) return false; // hand-made records belong to no site
  return ctx.siteScope.includes(siteId);
}

export function assertSiteInScope(ctx: TenantContext, siteId: string | null): void {
  if (!siteInScope(ctx, siteId)) {
    throw new Error("Sin acceso a este sitio");
  }
}

/** Narrows any list of site-bearing rows to what the caller may see. */
export function filterBySiteScope<T>(
  ctx: TenantContext,
  rows: T[],
  siteIdOf: (row: T) => string | null,
): T[] {
  if (ctx.siteScope === null) return rows;
  return rows.filter((row) => siteInScope(ctx, siteIdOf(row)));
}

/**
 * Contact ids the caller may see, or null when unrestricted. Conversations,
 * quotes and activities have no site column of their own, so they are scoped
 * through the contact that owns them.
 */
export async function contactIdsInScope(ctx: TenantContext): Promise<Set<string> | null> {
  if (ctx.siteScope === null) return null;
  if (ctx.siteScope.length === 0) return new Set();

  const rows = await tenantDb(ctx).select(
    contacts,
    inArray(contacts.firstSiteId, ctx.siteScope),
  );
  return new Set(rows.map((row) => row.id));
}
