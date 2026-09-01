import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/db/client";
import { accounts, sessions, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "./context";
import {
  addMembership,
  getActiveMembership,
  getMembership,
  listMembershipsForTenant,
  MembershipError,
  removeMembership,
  setActiveTenant,
  setMembershipBanned,
  setMembershipRole,
  countTenantAdmins as countMembershipAdmins,
} from "./memberships";

// User-tenant binding (PLAN.md §3.2). Assigning a user to a tenant/role is
// inherently cross-cutting (it's what *creates* the tenant boundary for that
// user), so it lives here in the tenancy module rather than behind
// tenantDb — everything else that touches `users` should go through
// tenantDb(ctx) so it can never read/write another tenant's users.

/**
 * Binds a user to a business and makes it their active one. Since §3.1 was
 * reopened this adds a *membership* rather than overwriting a single
 * `tenant_id`, so a user already working in another business keeps that
 * access — which is exactly what accepting a second invitation should mean.
 * Re-binding someone who is already a member is a no-op on the grant; it
 * still moves their active pointer, because they just asked to go there.
 */
export async function assignUserToTenant(
  userId: string,
  tenantId: string,
  role: "admin" | "agent",
) {
  const existing = await getMembership(userId, tenantId);
  if (!existing) {
    await addMembership({ userId, tenantId, role });
  }
  await setActiveTenant(userId, tenantId);
}

/**
 * Superadmin bootstrap (PLAN.md §10 1C follow-up #2, scripts/create-superadmin.ts):
 * inserts a user + credential account directly, the same shape Better
 * Auth's own email/password sign-up would produce. Only entry point for the
 * very first superadmin — sign-up itself is gated to invited emails, and
 * invitations can only be created by an existing admin/superadmin.
 */
export async function createSuperadminUser(input: {
  email: string;
  password: string;
  name: string;
}) {
  const userId = newId();

  await db.insert(users).values({
    id: userId,
    email: input.email,
    emailVerified: true,
    name: input.name,
    role: "superadmin",
    isSuperadmin: true,
    tenantId: null,
  });

  await db.insert(accounts).values({
    id: newId(),
    userId,
    accountId: userId,
    providerId: "credential",
    password: await hashPassword(input.password),
  });

  return getUserById(userId);
}

/**
 * Owner tenant bootstrap (PLAN.md §10 1H #1, scripts/seed-tenant.ts):
 * creates the admin user for a brand-new tenant the same way
 * createSuperadminUser does for the platform — inserts a user + credential
 * account directly, since there's no admin session yet to invite them
 * through the normal flow.
 */
export async function createTenantAdminUser(input: {
  tenantId: string;
  email: string;
  password: string;
  name: string;
  /** Defaults to `admin` — the bootstrap case the seed script needs. 1I's
   * superadmin console passes `agent` when standing up a whole team. */
  role?: "admin" | "agent";
}) {
  const userId = newId();

  await db.insert(users).values({
    id: userId,
    tenantId: input.tenantId,
    email: input.email,
    emailVerified: true,
    name: input.name,
    role: input.role ?? "admin",
    isSuperadmin: false,
  });

  await db.insert(accounts).values({
    id: newId(),
    userId,
    accountId: userId,
    providerId: "credential",
    password: await hashPassword(input.password),
  });

  // The grant lives in `tenant_memberships`; `users.tenant_id` above is only
  // the active-business pointer this new user starts on.
  await addMembership({ userId, tenantId: input.tenantId, role: input.role ?? "admin" });

  return getUserById(userId);
}

/** Resets a user's credential password in place — used by the idempotent
 * seed script when the user row already exists. */
export async function setUserPassword(userId: string, password: string) {
  await db
    .update(accounts)
    .set({ password: await hashPassword(password) })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
}

export async function getUserByEmail(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row ?? null;
}

export async function markSuperadmin(userId: string) {
  await db
    .update(users)
    .set({ isSuperadmin: true, role: "superadmin", tenantId: null })
    .where(eq(users.id, userId));
}

export async function getUserById(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row ?? null;
}

/**
 * The people who work in one business, shaped like plain user rows.
 *
 * `role` and `banned` are the *membership's*, not the user row's — the same
 * person may be an admin here and an agent next door, and deactivating them
 * here must not read as deactivated there. Every existing caller (assignee
 * pickers, the team page, CSV export) reads exactly those two fields, so
 * overlaying them keeps this a drop-in while making the values correct.
 */
async function membersOf(tenantId: string) {
  const rows = await listMembershipsForTenant(tenantId);
  return rows.map(({ user, membership }) => ({
    ...user,
    role: membership.role,
    banned: membership.banned,
    banReason: membership.banReason,
  }));
}

/** Tenant-scoped: the caller's own business, never anyone else's — the id
 * comes from the context, which is never client-supplied (§3.3). */
export function listTenantUsers(ctx: TenantContext) {
  return membersOf(ctx.tenantId);
}

/**
 * Superadmin-only: list a given tenant's members, for the impersonation
 * ("ver como") picker in the superadmin console and for the background jobs
 * that mail a tenant's users. Deliberately bypasses tenantDb (the caller has
 * no TenantContext of their own — that's the point of superadmin) so this
 * stays confined to the tenancy module.
 */
export async function listUsersForTenant(tenantId: string) {
  return membersOf(tenantId);
}

/** Businesses this user may act in — the switcher's list, and the guard the
 * superadmin console shows before adding someone to another one. */
export { listMembershipsForUser } from "./memberships";


// --- User lifecycle (PLAN.md §13 H4) ------------------------------------
//
// The `banned` columns have existed since the Better Auth schema landed and
// were referenced nowhere: there was no way to take a leaving salesperson's
// access away short of deleting the row (which would orphan their deals) or
// changing their password. Deactivation is that missing door, and it has to
// close *now*, not at session expiry — hence the session sweep below.

export class UserLifecycleError extends Error {
  constructor(readonly code: "notFound" | "self" | "lastAdmin") {
    super(code);
  }
}

/**
 * The user row behind a session, or null if it can no longer act in this
 * business: deleted, banned at platform level, or holding no live membership
 * here. getTenantContext calls this on every request alongside the membership
 * read, which is what makes both kinds of ban take effect immediately.
 *
 * The returned row carries the *membership's* role and banned flag, for the
 * same reason `membersOf` does: callers asking "can this person act here"
 * must not be handed the pointer-row's stale copy.
 */
export async function getActiveTenantUser(userId: string, tenantId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row || row.banned) return null;

  const membership = await getActiveMembership(userId, tenantId);
  if (!membership) return null;

  return { ...row, role: membership.role, banned: membership.banned };
}

/** Drops every session row for a user — the ban is worthless if the cookie
 * they already hold keeps working until it expires. */
export async function revokeUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** The target of an admin's action on a colleague: a member of the *caller's
 * own* business, and never the caller themselves. A user id from another
 * business simply has no membership here, so it fails as "not found" —
 * which is also the right answer to give a probe. */
async function requireSameTenantUser(ctx: TenantContext, userId: string) {
  const membership = await getMembership(userId, ctx.tenantId);
  if (!membership) throw new UserLifecycleError("notFound");
  if (userId === ctx.userId) throw new UserLifecycleError("self");

  const row = await getUserById(userId);
  if (!row) throw new UserLifecycleError("notFound");
  return { ...row, role: membership.role, banned: membership.banned };
}

/**
 * Deactivates or reactivates a member of the caller's own business — and only
 * there. Someone shut out of Tasación keeps working at their other businesses
 * exactly as before, which is the whole point of moving the flag onto the
 * membership.
 */
export async function setTenantUserBanned(
  ctx: TenantContext,
  userId: string,
  banned: boolean,
  reason?: string,
) {
  const target = await requireSameTenantUser(ctx, userId);

  // An admin deactivating the last other admin is fine; deactivating
  // *themselves* is what the self guard above already refuses.
  await setMembershipBanned(ctx.tenantId, userId, banned, reason);

  if (banned) {
    // Their sessions may be sitting in *this* business right now. Sweeping
    // every session is broader than the ban — it also signs them out of the
    // businesses they can still work in — but the alternative is a cookie
    // that keeps this business open until it expires, and re-login is the
    // cheaper of the two. (setMembershipBanned has already moved their active
    // pointer somewhere they can still go.)
    await revokeUserSessions(userId);
  }

  return target;
}

/** Active admins of one business (PLAN.md §13 H4, now per-membership). */
export function countTenantAdmins(tenantId: string, excludingUserId?: string) {
  return countMembershipAdmins(tenantId, excludingUserId);
}

/**
 * Promotes or demotes a member of the caller's own tenant. Refuses to leave
 * the tenant with no active admin — that state can only be repaired by a
 * superadmin, so it must not be reachable by a single click.
 */
export async function setTenantUserRole(
  ctx: TenantContext,
  userId: string,
  role: "admin" | "agent",
) {
  const target = await requireSameTenantUser(ctx, userId);

  try {
    await setMembershipRole(ctx.tenantId, userId, role);
  } catch (err) {
    // Same refusal, in this module's own error type — callers catch
    // UserLifecycleError and render the "último administrador" copy.
    if (err instanceof MembershipError && err.code === "lastAdmin") {
      throw new UserLifecycleError("lastAdmin");
    }
    throw err;
  }

  return target;
}

/**
 * Revokes a colleague's access to the caller's own business outright. Their
 * deals, conversations and timeline entries stay where they are — only the
 * grant goes. Distinct from deactivation: this one takes the business off
 * their switcher entirely.
 */
export async function removeTenantUser(ctx: TenantContext, userId: string) {
  const target = await requireSameTenantUser(ctx, userId);

  try {
    await removeMembership(ctx.tenantId, userId);
  } catch (err) {
    if (err instanceof MembershipError && err.code === "lastAdmin") {
      throw new UserLifecycleError("lastAdmin");
    }
    throw err;
  }

  await revokeUserSessions(userId);
  return target;
}

// --- Superadmin profile edit ---------------------------------------------
//
// `users` is a platform table (§4), so changing a member's name/email is a
// cross-tenant write in the same sense adding/removing a membership is
// (§3.1) — gated on is_superadmin, never reachable from a tenant admin's own
// role. Lives here, not in memberships.ts, because it edits the user row
// itself rather than a membership.

export class UserProfileError extends Error {
  constructor(readonly code: "notFound" | "emailTaken") {
    super(code);
  }
}

/** Updates a platform user's name/email. Email stays globally unique (users
 * is the platform's one identity table), so a collision is checked and
 * reported before it can hit the DB's unique constraint. */
export async function updateUserProfile(
  userId: string,
  input: { name: string; email: string },
) {
  const target = await getUserById(userId);
  if (!target) throw new UserProfileError("notFound");

  if (input.email !== target.email) {
    const existing = await getUserByEmail(input.email);
    if (existing && existing.id !== userId) throw new UserProfileError("emailTaken");
  }

  await db
    .update(users)
    .set({ name: input.name, email: input.email })
    .where(eq(users.id, userId));

  return getUserById(userId);
}

/** Per-user UI language (PLAN.md §13 H5). Not tenant-scoped on purpose: a
 * user may only ever change their own, and the action passes ctx.userId. */
export async function setUserLocale(userId: string, locale: string): Promise<void> {
  await db.update(users).set({ locale }).where(eq(users.id, userId));
}

/** Per-user light/dark preference (PLAN.md §14 I3). Stored beside the
 * locale for the same reason: it is a property of the person, not of the
 * browser they happen to be sitting at. */
export async function setUserTheme(userId: string, theme: string): Promise<void> {
  await db.update(users).set({ theme }).where(eq(users.id, userId));
}

/** Per-user daily task reminder opt-out (PLAN.md §13 H6). */
export async function setUserTaskReminders(userId: string, enabled: boolean): Promise<void> {
  await db.update(users).set({ taskReminders: enabled }).where(eq(users.id, userId));
}
