import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/client";
import { userSites } from "@/db/schema";
import { getTenant } from "./tenants";
import { computeAccessStatus, type AccessStatus } from "./subscriptions";

// The single sanctioned source of tenant identity (PLAN.md §3.3, layer 1).
// Resolved from the Better Auth session once per request. Client-supplied
// tenant IDs (query params, form fields, headers) must never be trusted —
// every module service takes a TenantContext, never a raw tenantId string
// from user input.

export type TenantRole = "admin" | "agent" | "client";

export type TenantContext = {
  tenantId: string;
  userId: string;
  role: TenantRole;
  /** Real superadmin user id, set only while impersonating this tenant user. */
  impersonatorUserId: string | null;
  /** Subscription/suspension state (PLAN.md §10 1B: "grace → read-only
   * banner → locked"). tenantDb's mutation methods (./db.ts) read this to
   * reject writes for anything but "active" — the single choke point every
   * tenant-owned mutation goes through, so grace/locked tenants are
   * read-only at the write path, not just the UI banner. */
  accessStatus: AccessStatus;
  /**
   * Per-user site restriction (PLAN.md §5.2). `null` means unrestricted —
   * the owner and their admins. A non-empty array narrows every read to
   * those sites, which is how one tenant can host both the owner's whole
   * network and a dentist client who must only ever see dentista.com.py.
   *
   * Resolved here, once, from user_sites — the same single-source-of-truth
   * discipline §3.3 applies to tenantId. No page or service may take a site
   * filter from user input.
   */
  siteScope: string[] | null;
};

export type SuperadminContext = {
  userId: string;
  /** Always null for a genuine superadmin session (you can't impersonate yourself). */
  impersonatorUserId: null;
};

type SessionUser = {
  id: string;
  tenantId?: string | null;
  role?: string | null;
  isSuperadmin?: boolean | null;
};

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Resolves the acting tenant context for the current request, or null if
 * there isn't one (unauthenticated, or a superadmin not impersonating).
 * Server components / server actions / route handlers only.
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const session = await getSession();
  if (!session) return null;

  const user = session.user as unknown as SessionUser;
  if (!user.tenantId) return null;
  if (user.role !== "admin" && user.role !== "agent" && user.role !== "client") return null;

  const tenant = await getTenant(user.tenantId);
  if (!tenant) return null;

  const impersonatedBy = (
    session.session as unknown as { impersonatedBy?: string | null }
  ).impersonatedBy;

  return {
    tenantId: user.tenantId,
    userId: user.id,
    role: user.role,
    impersonatorUserId: impersonatedBy ?? null,
    accessStatus: await computeAccessStatus(tenant.id, tenant.status),
    siteScope: await resolveSiteScope(user.id, user.role),
  };
}

/**
 * A `client` is always restricted, even with no grants — an empty array
 * means "no sites", not "all sites". Falling back to unrestricted there
 * would turn a misconfigured client account into a full view of the
 * owner's network.
 */
async function resolveSiteScope(userId: string, role: string): Promise<string[] | null> {
  const rows = await db.select().from(userSites).where(eq(userSites.userId, userId));
  if (rows.length > 0) return rows.map((row) => row.siteId);
  return role === "client" ? [] : null;
}

/**
 * Reconstructs a TenantContext for code paths with no Better Auth session at
 * all — public form submissions (tenant resolved by URL slug, not user
 * input) and, per §3.3, background jobs ("jobs carry tenant_id in their
 * payload and the worker reconstructs a tenant context before calling
 * services"). userId is a fixed sentinel, never a real user row — nothing
 * in tenantDb or the services built on it dereferences it as one. Returns
 * null if the tenant doesn't exist.
 */
export async function buildSystemTenantContext(
  tenantId: string,
): Promise<TenantContext | null> {
  const tenant = await getTenant(tenantId);
  if (!tenant) return null;

  return {
    tenantId,
    userId: "system",
    role: "agent",
    impersonatorUserId: null,
    accessStatus: await computeAccessStatus(tenant.id, tenant.status),
    // Background work and public ingest act for the whole tenant.
    siteScope: null,
  };
}

export async function requireTenantContext(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) {
    throw new Error("No tenant context: not authenticated as a tenant user");
  }
  return ctx;
}

/**
 * Tenant `admin`-only actions (PLAN.md §3.2: WhatsApp connection,
 * automations, users/invites, and — new in 1C — tenant settings; `agent`
 * works contacts/deals/inbox/quotes but doesn't manage tenant config).
 */
export async function requireTenantAdmin(): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  if (ctx.role !== "admin") {
    throw new Error("Se requiere rol de administrador");
  }
  return ctx;
}

/**
 * Actions a `client` must never reach (PLAN.md §5.2): sending from the
 * owner's WhatsApp number, editing automations, creating quotes. Blocking
 * the page is not enough — a server action is its own entry point and can
 * be POSTed to directly, so operator-only actions call this.
 */
export async function requireTenantOperator(): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  if (ctx.role === "client") {
    throw new Error("Sin permiso para esta acción");
  }
  return ctx;
}

/** Resolves the current superadmin identity, or null if not a superadmin. */
export async function getSuperadminContext(): Promise<SuperadminContext | null> {
  const session = await getSession();
  if (!session) return null;

  const user = session.user as unknown as SessionUser;
  if (!user.isSuperadmin) return null;

  return { userId: user.id, impersonatorUserId: null };
}

export async function requireSuperadminContext(): Promise<SuperadminContext> {
  const ctx = await getSuperadminContext();
  if (!ctx) {
    throw new Error("Superadmin required");
  }
  return ctx;
}
