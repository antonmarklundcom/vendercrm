import { and, asc, eq, inArray, like, max, or, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, tenantMemberships, tenants, users } from "@/db/schema";
import type { TenantRole } from "./context";

// The platform-wide user list (superadmin only). Every other user query in
// this module is scoped to one business, by design — this one deliberately is
// not, because "who is this person and which businesses can they reach" is a
// question only the platform can answer, and answering it in the console is
// what stops the operator from opening five tenant pages to find out.
//
// Superadmin-only by construction: it reads `db` directly, has no
// TenantContext to scope by, and lives behind requireSuperadminContext in the
// only route that calls it.

export type PlatformUserMembership = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: TenantRole;
  banned: boolean;
};

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  isSuperadmin: boolean;
  /** Platform-level ban — distinct from a membership being deactivated. */
  banned: boolean;
  createdAt: Date;
  /** Which business the switcher last put them in; null for superadmins. */
  activeTenantId: string | null;
  memberships: PlatformUserMembership[];
  /** Most recent session activity (created or refreshed), or null for
   * someone who has never logged in — a real state, not a zero. */
  lastLoginAt: Date | null;
  businessCount: number;
};

/** How many users one page of the console shows. */
export const PLATFORM_USER_PAGE_SIZE = 100;

export async function listPlatformUsers(
  options: { search?: string; limit?: number } = {},
): Promise<PlatformUser[]> {
  const search = options.search?.trim();
  const filter: SQL | undefined = search
    ? (or(like(users.email, `%${search}%`), like(users.name, `%${search}%`)) as SQL)
    : undefined;

  const rows = await db
    .select()
    .from(users)
    .where(filter)
    .orderBy(asc(users.email))
    .limit(options.limit ?? PLATFORM_USER_PAGE_SIZE);

  // Last activity per user, both timestamps: Better Auth bumps updated_at on
  // refresh, so the most recent of the two is the true "último ingreso"
  // regardless of whether the session was freshly created or just renewed.
  const sessionRows = await db
    .select({
      userId: sessions.userId,
      lastCreated: max(sessions.createdAt),
      lastUpdated: max(sessions.updatedAt),
    })
    .from(sessions)
    .groupBy(sessions.userId);
  const lastLoginByUser = new Map<string, Date>();
  for (const row of sessionRows) {
    const created = row.lastCreated ? new Date(row.lastCreated) : null;
    const updated = row.lastUpdated ? new Date(row.lastUpdated) : null;
    const latest =
      created && updated ? (created > updated ? created : updated) : (created ?? updated);
    if (latest) lastLoginByUser.set(row.userId, latest);
  }

  // One membership query for the whole page rather than one per user: at
  // PLATFORM_USER_PAGE_SIZE (100) users, a query-per-user blew through the
  // connection pool's queue limit (db/client.ts keeps both small on
  // purpose) and 500'd the page outright — the exact "select every message
  // ever" trap platform-stats.ts's own comment warns against, just with
  // rows-per-user instead of rows-per-tenant.
  const userIds = rows.filter((row) => !row.isSuperadmin).map((row) => row.id);
  const membershipRows = userIds.length
    ? await db
        .select({ membership: tenantMemberships, tenant: tenants })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .where(and(inArray(tenantMemberships.userId, userIds), eq(tenantMemberships.banned, false)))
    : [];
  const membershipsByUser = new Map<string, PlatformUserMembership[]>();
  for (const { membership, tenant } of membershipRows) {
    const list = membershipsByUser.get(membership.userId) ?? [];
    list.push({
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      role: membership.role,
      banned: membership.banned,
    });
    membershipsByUser.set(membership.userId, list);
  }
  for (const list of membershipsByUser.values()) {
    list.sort((a, b) => a.tenantName.localeCompare(b.tenantName));
  }

  return rows.map((row) => {
    const memberships = membershipsByUser.get(row.id) ?? [];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      isSuperadmin: row.isSuperadmin,
      banned: row.banned,
      createdAt: row.createdAt,
      activeTenantId: row.tenantId,
      lastLoginAt: lastLoginByUser.get(row.id) ?? null,
      businessCount: memberships.length,
      memberships,
    };
  });
}
