import { and, eq } from "drizzle-orm";
import { userSites } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Per-user site grants (PLAN.md §5.2).
//
// Absence of rows means unrestricted — that is deliberate. The owner and
// their admins have no rows and see everything; adding a row is what
// narrows someone. A restricted user with every one of their grants
// revoked therefore becomes unrestricted, which would be a privilege
// escalation, so revoking the last grant of a `client` is refused in
// grantSiteAccess/revokeSiteAccess's caller (see modules/access/users.ts).

export async function listSiteIdsForUser(
  ctx: TenantContext,
  userId: string,
): Promise<string[]> {
  const rows = await tenantDb(ctx).select(userSites, eq(userSites.userId, userId));
  return rows.map((row) => row.siteId);
}

export async function grantSiteAccess(ctx: TenantContext, userId: string, siteId: string) {
  const existing = await tenantDb(ctx).select(
    userSites,
    and(eq(userSites.userId, userId), eq(userSites.siteId, siteId)),
  );
  if (existing.length > 0) return;

  await tenantDb(ctx).insert(userSites).values({ id: newId(), userId, siteId });
}

export async function revokeSiteAccess(ctx: TenantContext, userId: string, siteId: string) {
  await tenantDb(ctx).delete(
    userSites,
    and(eq(userSites.userId, userId), eq(userSites.siteId, siteId)),
  );
}
