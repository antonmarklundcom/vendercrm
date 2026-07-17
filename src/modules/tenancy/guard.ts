import { redirect } from "next/navigation";
import { getSessionContext } from "./context";
import type { SessionContext, TenantContext } from "./types";
import { isTenantContext } from "./types";

// Page/layout guards: unlike the throwing require* helpers in context.ts, these
// redirect, so they're used from Server Components and layouts.

export async function requireSuperadminPage(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.isSuperadmin) redirect("/app");
  return ctx;
}

export async function requireTenantPage(): Promise<TenantContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // A superadmin who isn't impersonating has no tenant — send them to their
  // own console instead of a broken tenant view.
  if (!isTenantContext(ctx)) redirect("/superadmin");
  return ctx;
}
