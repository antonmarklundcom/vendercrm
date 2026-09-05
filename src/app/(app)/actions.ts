"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { stopImpersonation } from "@/modules/auth/impersonation";
import { requireTenantContext } from "@/modules/tenancy/context";
import { MembershipError, switchActiveTenant } from "@/modules/tenancy/memberships";
import { resolveSwitchTarget, SWITCH_FALLBACK } from "@/modules/tenancy/switch-target";

/** "Volver a la consola" — the exit half of impersonation, which existed in
 * modules/auth but had no caller anywhere in the UI (PLAN.md §13 H4). */
export async function stopImpersonationAction() {
  await stopImpersonation();
  redirect("/tenants");
}

// Switching business (PLAN.md §3.1). Both fields come from the browser and
// neither is trusted: `switchActiveTenant` refuses a tenant the user holds no
// live membership in, and `resolveSwitchTarget` reduces the path to a known
// section — or to the dashboard — rather than echoing it back.
const switchSchema = z.object({
  tenantId: z.string().min(1).max(26),
  /** Where they were, so the switch can keep them in the same section. */
  pathname: z.string().max(2000).optional(),
});

export async function switchBusinessAction(formData: FormData) {
  const ctx = await requireTenantContext();

  const parsed = switchSchema.safeParse({
    tenantId: formData.get("tenantId"),
    pathname: formData.get("pathname") ?? undefined,
  });
  // Hidden-id-only, so there is no field for a message to sit under: a
  // rejected switch simply leaves them where they are (PLAN.md §10 1R #6).
  if (!parsed.success) return;

  let target = SWITCH_FALLBACK;
  try {
    // The role can differ per business, and it decides where they may land —
    // so take it from the membership this returns, not from the context they
    // are leaving.
    const membership = await switchActiveTenant(ctx.userId, parsed.data.tenantId);
    target = resolveSwitchTarget(parsed.data.pathname, membership.role);
  } catch (err) {
    // No live membership for that business — a stale switcher, or a forged
    // id. Either way, stay put and say nothing: a distinguishable error here
    // would answer "is this a real tenant?" for anything posted.
    if (err instanceof MembershipError) return;
    throw err;
  }

  // The whole app shell is tenant-scoped, so nothing rendered before the
  // switch is still true.
  revalidatePath("/", "layout");
  redirect(target);
}

/**
 * Clears the bell (PLAN.md §15.5 J1). Scoped to the acting user inside the
 * module, so this action carries no id a caller could point at somebody
 * else's notifications.
 */
export async function markAllNotificationsReadAction() {
  const ctx = await requireTenantContext();
  const { markAllRead } = await import("@/modules/notifications/notifications");
  await markAllRead(ctx, ctx.userId);
  revalidatePath("/", "layout");
}
