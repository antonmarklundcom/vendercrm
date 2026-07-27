import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "./context";
import { tenantDb } from "./db";

// User-tenant binding (PLAN.md §3.2). Assigning a user to a tenant/role is
// inherently cross-cutting (it's what *creates* the tenant boundary for that
// user), so it lives here in the tenancy module rather than behind
// tenantDb — everything else that touches `users` should go through
// tenantDb(ctx) so it can never read/write another tenant's users.

export async function assignUserToTenant(
  userId: string,
  tenantId: string,
  role: "admin" | "agent" | "client",
) {
  await db.update(users).set({ tenantId, role }).where(eq(users.id, userId));
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

/** Tenant-scoped: list users belonging to the caller's own tenant. */
export function listTenantUsers(ctx: TenantContext) {
  return tenantDb(ctx).select(users);
}

/**
 * Superadmin-only: list a given tenant's users, for the impersonation
 * ("ver como") picker in the superadmin console. Deliberately bypasses
 * tenantDb (the caller has no TenantContext of their own — that's the
 * point of superadmin) so this stays confined to the tenancy module.
 */
export async function listUsersForTenant(tenantId: string) {
  return db.select().from(users).where(eq(users.tenantId, tenantId));
}
