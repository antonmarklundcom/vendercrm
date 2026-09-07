"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { applyVerticalPreset } from "@/modules/tenancy/verticals-apply";
import { SETUP_TOPICS, type SetupTopic } from "@/modules/setup/conversation";
import { generateSetupPlan, submitSetupAnswer } from "@/modules/setup/plan";
import { applySetupPlan, discardSetupPlan } from "@/modules/setup/apply";

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

// --- The setup assistant (PLAN.md §16.5, K2) ---------------------------
//
// Every action re-renders `/onboarding`: the page itself reads the current
// draft plan and conversation step fresh on each load, so there is no client
// state to keep in sync — a reload always shows exactly where the admin left
// off (§16.5 step 2's resume requirement).

function isSetupTopic(value: FormDataEntryValue | null): value is SetupTopic {
  return typeof value === "string" && (SETUP_TOPICS as readonly string[]).includes(value);
}

export async function submitSetupAnswerAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantAdmin();
  const topic = formData.get("topic");
  if (!isSetupTopic(topic)) return;

  const answer = String(formData.get("answer") ?? "");
  const skip = formData.get("skip") === "1";
  const state = await submitSetupAnswer(ctx, { topic, answer, skip });

  // The last topic just answered: generate the plan right away so the next
  // render shows the preview instead of an empty "done" screen.
  if (state.stepIndex >= SETUP_TOPICS.length) {
    await generateSetupPlan(ctx);
  }

  revalidatePath("/onboarding");
  redirect("/onboarding");
}

/** Retries plan generation for the current draft — the AI-unavailable and
 *  generation-failed states both offer this rather than only the manual
 *  picker, since a transient provider error is exactly the case a second
 *  attempt fixes. */
export async function retrySetupPlanAction(): Promise<void> {
  const ctx = await requireTenantAdmin();
  await generateSetupPlan(ctx);
  revalidatePath("/onboarding");
  redirect("/onboarding");
}

export async function applySetupPlanAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantAdmin();
  const planId = String(formData.get("planId") ?? "");
  if (!planId) return;

  const result = await applySetupPlan(ctx, planId);
  if (!result.ok) return;

  revalidatePath("/booking");
  revalidatePath("/onboarding");
  redirect("/booking");
}

/** "Empezar de nuevo": discards the draft (conversation and/or generated
 *  plan) so the assistant starts asking from the first topic again. */
export async function discardSetupPlanAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantAdmin();
  const planId = String(formData.get("planId") ?? "");
  if (planId) await discardSetupPlan(ctx, planId);

  revalidatePath("/onboarding");
  redirect("/onboarding");
}
