"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { applyVerticalPreset } from "@/modules/tenancy/verticals-apply";

// The wizard's one write (plan-booking.md §6.1). Applying is additive and
// idempotent by construction (see verticals-apply.ts), so a double submit
// costs nothing and there is no confirmation step to get wrong.

export async function applyVerticalAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantAdmin();
  const vertical = String(formData.get("vertical") ?? "");
  if (!vertical) return;

  const outcome = await applyVerticalPreset(ctx, vertical);
  if ("error" in outcome) return;

  revalidatePath("/booking");
  revalidatePath("/onboarding");
  // Straight to the booking page: the point of the wizard is that the tenant
  // now has a public link to share, and that is where they can see it.
  redirect("/booking");
}
