"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { startImpersonation } from "@/modules/auth/impersonation";
import { getDeal } from "@/modules/crm/deals";
import { buildSystemTenantContext, requireSuperadminContext } from "@/modules/tenancy/context";
import { writeAuditLog } from "@/modules/tenancy/audit";
import {
  listMembershipsForTenant,
  MembershipError,
  switchActiveTenant,
} from "@/modules/tenancy/memberships";

// "Abrir en la cuenta" (PLAN.md §19.4, Link-through). The cross-account view
// is a read-only window; this is the one door out of it, and it grants
// nothing the superadmin did not already have:
//
//  1. A live membership in that business → the existing membership-checked
//     switch, then the deal is confirmed *inside* that business before the
//     redirect. (A separate action from the business switcher on purpose:
//     `resolveSwitchTarget` keeps dropping ids and its tests stay as they are.)
//  2. No membership → the audited "ver como" impersonation of the business's
//     first active admin, exactly the flow the Empresas table uses.
//
// Both ids come from a rendered page and are not trusted. A deal id that
// belongs to another business, or to none, ends on the same `notFound()` —
// there is no existence oracle.

const ID_PATTERN = /^[0-9A-Za-z]{26}$/;

/** The business's oldest active admin whose account may be entered ("ver como"). */
async function firstImpersonableAdmin(tenantId: string): Promise<string | null> {
  const members = await listMembershipsForTenant(tenantId);
  const admins = members
    .filter(
      ({ membership, user }) =>
        membership.role === "admin" && !membership.banned && !user.banned && !user.isSuperadmin,
    )
    .sort((a, b) => a.membership.createdAt.getTime() - b.membership.createdAt.getTime());
  return admins[0]?.user.id ?? null;
}

/** Read-only existence check of the deal inside the business, as that business sees it. */
async function dealExistsInTenant(tenantId: string, dealId: string): Promise<boolean> {
  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return false;
  return !!(await getDeal(ctx, dealId));
}

export async function openInAccountAction(tenantId: string, dealId: string): Promise<void> {
  const sa = await requireSuperadminContext();
  if (typeof tenantId !== "string" || typeof dealId !== "string") notFound();
  if (!ID_PATTERN.test(tenantId) || !ID_PATTERN.test(dealId)) notFound();

  const audit = (via: "membership" | "impersonation") =>
    writeAuditLog({
      tenantId,
      actorUserId: sa.userId,
      action: "platform.deal.opened_in_account",
      entity: "deal",
      entityId: dealId,
      payload: { tenantId, dealId, via },
    });

  // 1. Live membership: switch, then confirm the deal after the switch.
  let switched = false;
  try {
    await switchActiveTenant(sa.userId, tenantId);
    switched = true;
  } catch (err) {
    // No live membership (or no such business): fall through to "ver como".
    if (!(err instanceof MembershipError)) throw err;
  }

  if (switched) {
    if (!(await dealExistsInTenant(tenantId, dealId))) notFound();
    await audit("membership");
    // The whole app shell is tenant-scoped; nothing rendered before the
    // switch is still true.
    revalidatePath("/", "layout");
    redirect(`/pipeline/${dealId}`);
  }

  // 2. No membership: the audited impersonation flow; nothing new is granted.
  if (!(await dealExistsInTenant(tenantId, dealId))) notFound();
  const adminUserId = await firstImpersonableAdmin(tenantId);
  const back = `/platform-leads/${tenantId}/deals/${dealId}?openError=1`;
  if (!adminUserId) redirect(back);

  try {
    await startImpersonation(adminUserId, tenantId);
  } catch {
    // Refused or failed before the session swap: the superadmin is still
    // here, so say so on the detail page.
    redirect(back);
  }
  await audit("impersonation");
  redirect(`/pipeline/${dealId}`);
}
