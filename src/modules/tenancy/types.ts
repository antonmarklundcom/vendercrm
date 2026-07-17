export type TenantRole = "admin" | "agent";

// Resolved once per request from the session (or impersonation), this is the
// ONLY sanctioned source of tenantId (PLAN.md §3.3). Client-supplied tenant IDs
// are never trusted.
export type SessionContext = {
  userId: string;
  // Effective user's tenant. NULL for a superadmin who is not impersonating.
  tenantId: string | null;
  // Effective user's tenant role. NULL for superadmins.
  role: TenantRole | null;
  // True when the effective user is a platform superadmin (i.e. not
  // impersonating a tenant user).
  isSuperadmin: boolean;
  // When a superadmin is impersonating, this is the real superadmin's user id;
  // otherwise null. Every impersonated write is audited with both (PLAN.md §3.2).
  impersonatorUserId: string | null;
};

// Narrowed context for tenant-scoped work: tenantId + role are guaranteed
// present. This is what tenantDb and every tenant module service require.
export type TenantContext = SessionContext & {
  tenantId: string;
  role: TenantRole;
};

export function isTenantContext(
  ctx: SessionContext,
): ctx is TenantContext {
  return ctx.tenantId !== null && ctx.role !== null;
}
