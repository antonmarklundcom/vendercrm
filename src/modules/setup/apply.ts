import { eq } from "drizzle-orm";
import { setupPlans } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { applyPreset, type ApplyOutcome } from "@/modules/tenancy/verticals-apply";
import { setProfileVertical } from "@/modules/memory/profile";
import { writeAuditLog } from "@/modules/tenancy/audit";
import type { VerticalPreset } from "@/modules/tenancy/verticals";
import { getSetupPlan } from "./plan";

// Preview + apply (PLAN.md §16.5 steps 4-5). Preview is just the plan's own
// preset — the onboarding page renders it with the same component the manual
// picker uses (page.tsx), extended for quick replies and stage flags.
// Applying goes through the exact function the catalogue uses
// (`applyPreset`, §16.2 rule 3), so a plan the assistant generated is
// afterwards indistinguishable from a rubro picked by hand.

export type ApplySetupPlanResult =
  | { ok: true; outcome: ApplyOutcome }
  | { ok: false; reason: "not_found" | "no_preset" | "already_applied" };

export async function applySetupPlan(ctx: TenantContext, planId: string): Promise<ApplySetupPlanResult> {
  const plan = await getSetupPlan(ctx, planId);
  if (!plan) return { ok: false, reason: "not_found" };
  if (plan.status === "applied") return { ok: false, reason: "already_applied" };
  if (!plan.preset) return { ok: false, reason: "no_preset" };

  const preset = plan.preset as unknown as VerticalPreset;
  const outcome = await applyPreset(ctx, preset);
  await setProfileVertical(ctx, preset.slug);

  await tenantDb(ctx)
    .update(setupPlans)
    .set({ status: "applied", outcome, appliedAt: new Date(), updatedAt: new Date() })
    .where(eq(setupPlans.id, plan.id));

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "setup.plan_applied",
    entity: "setup_plan",
    entityId: plan.id,
    payload: { vertical: preset.slug, created: outcome.created },
  });

  return { ok: true, outcome };
}

export async function discardSetupPlan(ctx: TenantContext, planId: string): Promise<void> {
  const plan = await getSetupPlan(ctx, planId);
  if (!plan || plan.status !== "draft") return;
  await tenantDb(ctx)
    .update(setupPlans)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(eq(setupPlans.id, plan.id));
}
