import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user, account, tenants, invitations } from "@/db/schema";
import { newId } from "@/lib/ids";
import { auth } from "@/modules/auth/server";
import type { TenantContext, TenantRole } from "./types";
import { tenantDb } from "./db";

// Single, side-effect-free user creator used by every path (superadmin seed,
// tenant admin, invited user). Inserts the user row + a credential account with
// a password hashed by Better Auth's own hasher, so `signInEmail` verifies it
// normally. Deliberately does NOT create a session (unlike signUpEmail), so an
// admin creating a user is never silently logged in as them.
async function createUserWithPassword(input: {
  email: string;
  password: string;
  name: string;
  role: "superadmin" | "user";
  tenantId: string | null;
  tenantRole: TenantRole | null;
}): Promise<string> {
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(input.password);
  const userId = newId();

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: userId,
      email: input.email.toLowerCase(),
      name: input.name,
      emailVerified: false,
      role: input.role,
      tenantId: input.tenantId,
      tenantRole: input.tenantRole,
    });
    await tx.insert(account).values({
      id: newId(),
      userId,
      // Better Auth convention for email/password: providerId "credential",
      // accountId = userId.
      providerId: "credential",
      accountId: userId,
      password: passwordHash,
    });
  });

  return userId;
}

export async function createSuperadmin(input: {
  email: string;
  password: string;
  name: string;
}): Promise<string> {
  return createUserWithPassword({
    ...input,
    role: "superadmin",
    tenantId: null,
    tenantRole: null,
  });
}

// Superadmin-only: create a tenant and its first admin user (PLAN.md §1B).
export async function createTenant(input: {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
  status?: "active" | "suspended" | "trial";
}): Promise<{ tenantId: string; adminUserId: string }> {
  const tenantId = newId();
  await db.insert(tenants).values({
    id: tenantId,
    name: input.name,
    slug: input.slug.toLowerCase(),
    status: input.status ?? "trial",
  });

  const adminUserId = await createUserWithPassword({
    email: input.adminEmail,
    password: input.adminPassword,
    name: input.adminName,
    role: "user",
    tenantId,
    tenantRole: "admin",
  });

  return { tenantId, adminUserId };
}

// --- Tenant management (superadmin, platform-level) --------------------------

export async function listTenants() {
  return db.select().from(tenants).orderBy(tenants.createdAt);
}

export async function getTenant(tenantId: string) {
  const [row] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row ?? null;
}

export async function setTenantStatus(
  tenantId: string,
  status: "active" | "suspended" | "trial",
): Promise<void> {
  await db.update(tenants).set({ status }).where(eq(tenants.id, tenantId));
}

// --- Invitations (tenant-scoped) ---------------------------------------------

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvitation(
  ctx: TenantContext,
  input: { email: string; role: TenantRole },
): Promise<{ id: string; token: string }> {
  const tdb = tenantDb(ctx);
  const id = newId();
  const token = randomBytes(24).toString("hex");
  await tdb.insert(invitations, {
    id,
    email: input.email.toLowerCase(),
    role: input.role,
    token,
    invitedByUserId: ctx.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return { id, token };
}

export async function listInvitations(ctx: TenantContext) {
  return tenantDb(ctx).select(invitations);
}

export async function revokeInvitation(
  ctx: TenantContext,
  invitationId: string,
): Promise<void> {
  await tenantDb(ctx).delete(invitations, eq(invitations.id, invitationId));
}

// Unauthenticated accept flow: the token is the bearer credential, so this
// looks the invite up globally (not through tenantDb) and then creates the user
// bound to that invite's tenant.
export async function acceptInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ userId: string; tenantId: string; email: string }> {
  const [invite] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, input.token))
    .limit(1);

  if (!invite) throw new Error("Invitación no encontrada");
  if (invite.acceptedAt) throw new Error("Invitación ya utilizada");
  if (invite.expiresAt.getTime() < Date.now())
    throw new Error("Invitación expirada");

  const userId = await createUserWithPassword({
    email: invite.email,
    password: input.password,
    name: input.name,
    role: "user",
    tenantId: invite.tenantId,
    tenantRole: invite.role,
  });

  await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(eq(invitations.id, invite.id));

  return { userId, tenantId: invite.tenantId, email: invite.email };
}

export async function listTenantUsers(ctx: TenantContext) {
  return db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      tenantRole: user.tenantRole,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(and(eq(user.tenantId, ctx.tenantId)));
}
