import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export type TenantRole = "admin" | "agent";

export type TenantContext = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  isImpersonating: boolean;
  /** The real logged-in user's id when a superadmin is impersonating this tenant user. */
  actorUserId: string;
};

export type SuperadminContext = {
  userId: string;
};

export type SessionShape = {
  user: {
    id: string;
    tenantId?: string | null;
    role?: string | null;
  };
  session: {
    impersonatedBy?: string | null;
  };
};

export class UnauthenticatedError extends Error {
  constructor() {
    super("No active session");
  }
}

export class NotATenantUserError extends Error {
  constructor() {
    super("Session does not belong to a tenant user (missing tenantId/role, or is a superadmin session)");
  }
}

export class NotASuperadminError extends Error {
  constructor() {
    super("Session does not belong to a superadmin");
  }
}

/**
 * Pure derivation of a TenantContext from a resolved session. Split out from
 * `getTenantContext()` so it's testable without a Next.js request context.
 */
export function deriveTenantContext(session: SessionShape | null): TenantContext {
  if (!session) throw new UnauthenticatedError();

  const { user, session: sessionRow } = session;

  if (!user.tenantId || (user.role !== "admin" && user.role !== "agent")) {
    throw new NotATenantUserError();
  }

  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    isImpersonating: Boolean(sessionRow.impersonatedBy),
    actorUserId: sessionRow.impersonatedBy ?? user.id,
  };
}

export function deriveSuperadminContext(session: SessionShape | null): SuperadminContext {
  if (!session) throw new UnauthenticatedError();

  const { user, session: sessionRow } = session;

  if (user.role !== "superadmin" || sessionRow.impersonatedBy) {
    throw new NotASuperadminError();
  }

  return { userId: user.id };
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * The single sanctioned source of `tenantId` for request-scoped code.
 * Never trust a client-supplied tenant id anywhere else in the app.
 */
export async function getTenantContext(): Promise<TenantContext> {
  return deriveTenantContext(await getSession());
}

export async function getSuperadminContext(): Promise<SuperadminContext> {
  return deriveSuperadminContext(await getSession());
}
