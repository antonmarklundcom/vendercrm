import { and, count, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions, tenantMemberships, tenants, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext, TenantRole } from "./context";

// Who may act in which business (PLAN.md §3.1, reopened — see §1.2). A
// membership is the grant: one row per (user, tenant), carrying the role for
// that pairing and its own deactivation flag.
//
// This module is deliberately the only place that reads or writes
// `tenant_memberships` without a TenantContext. Binding a user to a tenant is
// what *creates* the tenant boundary for that user, so it cannot itself sit
// behind tenantDb — the same exemption `assignUserToTenant` has always had
// (§3.3). Every caller outside this module goes through a function here.

export type Membership = typeof tenantMemberships.$inferSelect;

/** A membership plus the business it grants access to — what the switcher and
 * the superadmin console both need to render a row. */
export type MembershipWithTenant = {
  membership: Membership;
  tenant: typeof tenants.$inferSelect;
};

export class MembershipError extends Error {
  constructor(
    readonly code: "notFound" | "alreadyMember" | "lastAdmin" | "self",
  ) {
    super(code);
  }
}

/**
 * The membership that lets `userId` act in `tenantId` right now, or null.
 *
 * This is the load-bearing read of the whole feature: `getTenantContext`
 * calls it on every request, so an access revoked a second ago takes effect
 * on the next click rather than at session expiry (PLAN.md §13 H4). A cookie
 * naming a tenant is a claim, never a grant — it is only ever as good as the
 * row this returns.
 */
export async function getActiveMembership(
  userId: string,
  tenantId: string,
): Promise<Membership | null> {
  const [row] = await db
    .select()
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.banned, false),
      ),
    );
  return row ?? null;
}

/** Every business this user may switch into, newest membership last. Banned
 * memberships are excluded: a business you cannot enter is not a choice. */
export async function listMembershipsForUser(
  userId: string,
): Promise<MembershipWithTenant[]> {
  const rows = await db
    .select({ membership: tenantMemberships, tenant: tenants })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(
      and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.banned, false)),
    );

  return rows.sort((a, b) => a.tenant.name.localeCompare(b.tenant.name));
}

/** Every membership of one business, with the person behind it. Used by the
 * tenant's own /users page and by the superadmin console. */
export async function listMembershipsForTenant(tenantId: string) {
  return db
    .select({ membership: tenantMemberships, user: users })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(eq(tenantMemberships.tenantId, tenantId));
}

export async function getMembership(userId: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.tenantId, tenantId),
      ),
    );
  return row ?? null;
}

/**
 * Grants an existing user access to a business. Cross-tenant by definition,
 * so the caller must be a superadmin (§3.3 keeps this out of tenant admins'
 * reach — a tenant admin can set a role inside their own business, but only
 * the platform decides who is let in).
 *
 * Idempotent-ish: re-adding someone who is already a member is an error
 * rather than a silent no-op, because the caller asked for something that
 * did not happen and the console should say so.
 */
export async function addMembership(input: {
  userId: string;
  tenantId: string;
  role: TenantRole;
}): Promise<Membership> {
  const existing = await getMembership(input.userId, input.tenantId);
  if (existing) throw new MembershipError("alreadyMember");

  const id = newId();
  await db.insert(tenantMemberships).values({
    id,
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
  });

  // A user whose only businesses are ones they were never active in has no
  // active pointer yet; point them at this one so their first login lands
  // somewhere real rather than on "no tenant context".
  await adoptAsActiveTenantIfUnset(input.userId, input.tenantId);

  const created = await getMembership(input.userId, input.tenantId);
  if (!created) throw new MembershipError("notFound");
  return created;
}

/** Active admins of a business — the count that last-admin protection turns
 * on. Optionally excludes one user, for "what would be left if I demoted
 * this one". */
export async function countTenantAdmins(
  tenantId: string,
  excludingUserId?: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.role, "admin"),
        eq(tenantMemberships.banned, false),
        excludingUserId ? ne(tenantMemberships.userId, excludingUserId) : undefined,
      ),
    );
  return row?.value ?? 0;
}

/** Active members of a business — the seat count plan limits enforce
 * (PLAN.md §13 H6). Counted per business, not per user row: one person in two
 * businesses holds a seat in each, and burns neither one's ceiling for the
 * other. */
export async function countTenantMembers(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.banned, false),
      ),
    );
  return row?.value ?? 0;
}

/** Sets a member's role within one business. Refuses to leave the business
 * with no active admin — that state can only be repaired by a superadmin, so
 * it must not be reachable by a single click. */
export async function setMembershipRole(
  tenantId: string,
  userId: string,
  role: TenantRole,
): Promise<Membership> {
  const membership = await getMembership(userId, tenantId);
  if (!membership) throw new MembershipError("notFound");

  if (membership.role === "admin" && role === "agent") {
    const remaining = await countTenantAdmins(tenantId, userId);
    if (remaining === 0) throw new MembershipError("lastAdmin");
  }

  await db
    .update(tenantMemberships)
    .set({ role, updatedAt: new Date() })
    .where(eq(tenantMemberships.id, membership.id));

  await syncAuthRole(userId);
  return { ...membership, role };
}

/** Deactivates or reactivates one membership. Scoped to the business by
 * construction: deactivating someone at one business leaves their access to
 * every other one exactly as it was. */
export async function setMembershipBanned(
  tenantId: string,
  userId: string,
  banned: boolean,
  reason?: string,
): Promise<Membership> {
  const membership = await getMembership(userId, tenantId);
  if (!membership) throw new MembershipError("notFound");

  await db
    .update(tenantMemberships)
    .set({
      banned,
      banReason: banned ? (reason?.slice(0, 500) ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(tenantMemberships.id, membership.id));

  // Both directions need the pointer looked at, not just the ban. Deactivating
  // moves them off a business they can no longer enter; *re*activating has to
  // put them back, because the deactivation may have left them pointing at
  // nothing — and a user with a null pointer and a perfectly good membership
  // lands on "no tenant context" at their next login.
  await repairActiveTenant(userId);

  return { ...membership, banned };
}

/** Revokes access outright. Their work (deals, conversations, timeline) stays
 * where it is — only the grant goes, which is why this is a delete of the
 * membership and never of the user. */
export async function removeMembership(
  tenantId: string,
  userId: string,
): Promise<void> {
  const membership = await getMembership(userId, tenantId);
  if (!membership) throw new MembershipError("notFound");

  if (membership.role === "admin" && !membership.banned) {
    const remaining = await countTenantAdmins(tenantId, userId);
    if (remaining === 0) throw new MembershipError("lastAdmin");
  }

  await db.delete(tenantMemberships).where(eq(tenantMemberships.id, membership.id));

  // Their browsers in this business go with the grant. Nothing would reach
  // them anyway (the send re-checks membership), but the rows are dead
  // weight. Other businesses they still belong to keep theirs.
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, userId)));

  // Their active pointer may have just become a business they cannot enter.
  await repairActiveTenant(userId);
}

// --- Active business pointer ---------------------------------------------
//
// `users.tenant_id` is where the switcher remembers what you were looking at.
// It grants nothing on its own (getTenantContext re-checks it against a live
// membership), but it should never point somewhere you cannot go, or the next
// login lands on an error page.

async function adoptAsActiveTenantIfUnset(userId: string, tenantId: string) {
  const [row] = await db
    .select({ tenantId: users.tenantId, isSuperadmin: users.isSuperadmin })
    .from(users)
    .where(eq(users.id, userId));
  // Superadmins keep tenant_id NULL by definition (§3.2) — impersonation, not
  // membership, is how they enter a tenant.
  if (!row || row.isSuperadmin || row.tenantId) return;
  await setActiveTenant(userId, tenantId);
}

/** Points a user at one of their businesses. The membership check is the
 * caller's job — `switchActiveTenant` below is the checked entry point. */
export async function setActiveTenant(
  userId: string,
  tenantId: string | null,
): Promise<void> {
  await db.update(users).set({ tenantId }).where(eq(users.id, userId));
  await syncAuthRole(userId);
}

/**
 * The switcher's write. Verifies the membership before moving the pointer, so
 * a forged business id in a form post is refused here rather than caught two
 * layers down — and returns the membership so the caller can act on the new
 * role without a second read.
 */
export async function switchActiveTenant(
  userId: string,
  tenantId: string,
): Promise<Membership> {
  const membership = await getActiveMembership(userId, tenantId);
  if (!membership) throw new MembershipError("notFound");
  await setActiveTenant(userId, tenantId);
  return membership;
}

/** After access changes, make sure the active pointer still names a business
 * this user can enter; fall back to any other membership, else null. */
export async function repairActiveTenant(userId: string): Promise<void> {
  const [row] = await db
    .select({ tenantId: users.tenantId, isSuperadmin: users.isSuperadmin })
    .from(users)
    .where(eq(users.id, userId));
  if (!row || row.isSuperadmin) return;

  if (row.tenantId && (await getActiveMembership(userId, row.tenantId))) return;

  const remaining = await listMembershipsForUser(userId);
  await setActiveTenant(userId, remaining[0]?.tenant.id ?? null);
}

/**
 * Keeps `users.role` agreeing with the active membership.
 *
 * Nothing in this app's authorization reads that column (§3.2: tenant role
 * comes from the membership, platform powers from `is_superadmin`) — it
 * exists for Better Auth's admin-plugin `adminRoles` gate, which must keep
 * seeing a non-"superadmin" value for tenant users. Letting it drift would
 * mean a demoted admin still reads as "admin" to the plugin.
 */
async function syncAuthRole(userId: string): Promise<void> {
  const [row] = await db
    .select({ tenantId: users.tenantId, isSuperadmin: users.isSuperadmin })
    .from(users)
    .where(eq(users.id, userId));
  if (!row || row.isSuperadmin) return;

  const membership = row.tenantId
    ? await getActiveMembership(userId, row.tenantId)
    : null;

  await db
    .update(users)
    .set({ role: membership?.role ?? null })
    .where(eq(users.id, userId));
}

/** The tenant-scoped read the /users page needs: memberships of the caller's
 * own business, never anyone else's. Takes a context rather than a tenant id
 * so a caller cannot pass one in from a request. */
export function listMembershipsForContext(ctx: TenantContext) {
  return listMembershipsForTenant(ctx.tenantId);
}
