import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { auth } from "@/modules/auth/server";
import type { SessionContext, TenantContext, TenantRole } from "./types";
import { isTenantContext } from "./types";

// Loads the effective user row and derives the session context. When a
// superadmin is impersonating, Better Auth's session.userId is the TARGET
// tenant user, so tenantId/role naturally come from that user; impersonatedBy
// carries the real superadmin (PLAN.md §3.2/§3.3).
async function resolveContext(
  reqHeaders: Headers,
): Promise<SessionContext | null> {
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) return null;

  const [row] = await db
    .select({
      id: user.id,
      tenantId: user.tenantId,
      tenantRole: user.tenantRole,
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (!row) return null;

  return {
    userId: row.id,
    tenantId: row.tenantId ?? null,
    role: (row.tenantRole as TenantRole | null) ?? null,
    isSuperadmin: row.role === "superadmin",
    impersonatorUserId:
      (session.session as { impersonatedBy?: string | null }).impersonatedBy ??
      null,
  };
}

/** Session context or null when unauthenticated. Never throws on no-session. */
export async function getSessionContext(): Promise<SessionContext | null> {
  return resolveContext(await headers());
}

/**
 * Require a tenant-scoped context. Throws if unauthenticated or if the user is
 * a superadmin not currently impersonating a tenant (they have no tenantId).
 * This is the gate every tenant module service sits behind.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new UnauthenticatedError();
  if (!isTenantContext(ctx)) throw new NoTenantError();
  return ctx;
}

/** Require a platform superadmin (not impersonating). */
export async function requireSuperadmin(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new UnauthenticatedError();
  if (!ctx.isSuperadmin) throw new ForbiddenError();
  return ctx;
}

// Background jobs run outside a request: they carry tenant_id (and optionally a
// user) in their payload and reconstruct a context to go through the same
// scoped layer (PLAN.md §3.3). No session is involved, so callers are trusted
// to pass a tenantId that came from a trusted job payload.
export function tenantContextFromJob(input: {
  tenantId: string;
  userId?: string;
  role?: TenantRole;
}): TenantContext {
  return {
    userId: input.userId ?? "system",
    tenantId: input.tenantId,
    role: input.role ?? "admin",
    isSuperadmin: false,
    impersonatorUserId: null,
  };
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated");
    this.name = "UnauthenticatedError";
  }
}
export class NoTenantError extends Error {
  constructor() {
    super("No tenant context");
    this.name = "NoTenantError";
  }
}
export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}
