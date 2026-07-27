import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { listSiteIdsForUser, grantSiteAccess, revokeSiteAccess } from "./sites";

// Team + client account management (PLAN.md §5.2). Admin-only; the caller
// side enforces that via requireTenantAdmin.

export type TenantUserRow = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  siteIds: string[];
};

export async function listTenantUsersWithAccess(ctx: TenantContext): Promise<TenantUserRow[]> {
  const rows = await tenantDb(ctx).select(users);

  return Promise.all(
    rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        siteIds: await listSiteIdsForUser(ctx, row.id),
      })),
  );
}

export async function setUserRole(
  ctx: TenantContext,
  userId: string,
  role: "admin" | "agent" | "client",
) {
  await tenantDb(ctx).update(users).set({ role }).where(eq(users.id, userId));
}

/**
 * Replaces a user's site grants wholesale.
 *
 * A `client` with no grants would resolve to an empty scope (see
 * resolveSiteScope) and see nothing — safe, but useless — so this refuses
 * the empty case rather than silently creating a dead account. An admin is
 * never restricted, so grants are cleared for them instead.
 */
export async function setUserSites(ctx: TenantContext, userId: string, siteIds: string[]) {
  const [user] = await tenantDb(ctx).select(users, eq(users.id, userId));
  if (!user) throw new Error("Usuario no encontrado");

  if (user.role === "client" && siteIds.length === 0) {
    throw new Error("Un cliente necesita acceso a al menos un sitio");
  }

  const current = await listSiteIdsForUser(ctx, userId);

  for (const siteId of siteIds) {
    if (!current.includes(siteId)) await grantSiteAccess(ctx, userId, siteId);
  }
  for (const siteId of current) {
    if (!siteIds.includes(siteId)) await revokeSiteAccess(ctx, userId, siteId);
  }
}
