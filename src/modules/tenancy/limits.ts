import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { contacts, sites } from "@/db/schema";
import { getLatestSubscriptionForTenant } from "./subscriptions";
import { getPlan } from "./plans";
import { countTenantMembers } from "./memberships";
import { buildSystemTenantContext } from "./context";
import { countEmailsSentToday } from "./email-log";
import type { TenantContext } from "./context";

// Plan limit enforcement (PLAN.md §13 H6). `plans.limits` has been written
// since the plan catalog landed and never read once — a plan could say
// "3 seats" and the tenant could invite thirty. The shape is fixed here, and
// `null`/absent means unlimited so every existing plan row (all of them
// `{}`) keeps behaving exactly as it does today.
//
// `plans.features` gating stays deferred (§13 H6): no speculative flags
// until a real differentiated plan exists.

export const planLimitsSchema = z.object({
  maxUsers: z.number().int().positive().nullable().optional(),
  maxContacts: z.number().int().positive().nullable().optional(),
  maxSitesConnected: z.number().int().positive().nullable().optional(),
  /** Automated (not transactional) emails per rolling 24h — Resend's own
   * limits are per platform account, so pacing a tenant's automated volume
   * belongs in `plans.limits` (PLAN.md §15.1). */
  maxEmailsPerDay: z.number().int().positive().nullable().optional(),
});

export type PlanLimits = z.infer<typeof planLimitsSchema>;

export type LimitKey = "maxUsers" | "maxContacts" | "maxSitesConnected" | "maxEmailsPerDay";

export type LimitCheck = {
  allowed: boolean;
  /** null when the plan sets no limit for this resource. */
  limit: number | null;
  current: number;
};

const UNLIMITED: LimitCheck = { allowed: true, limit: null, current: 0 };

/** A tenant with no subscription, or one on a plan with no limits, is
 * unlimited — the enforcement exists to hold a sold plan to its own terms,
 * not to lock out tenants the console hasn't finished setting up. */
export async function getTenantLimits(tenantId: string): Promise<PlanLimits> {
  const subscription = await getLatestSubscriptionForTenant(tenantId);
  if (!subscription) return {};

  const plan = await getPlan(subscription.planId);
  if (!plan) return {};

  const parsed = planLimitsSchema.safeParse(plan.limits ?? {});
  // A malformed limits blob is a console bug, not a reason to refuse work:
  // treat it as unlimited and let the superadmin fix the plan row.
  return parsed.success ? parsed.data : {};
}

async function currentUsage(tenantId: string, key: LimitKey): Promise<number> {
  if (key === "maxUsers") {
    // Seats are memberships, not user rows. One person working in two
    // businesses holds a seat in each and burns neither one's ceiling for
    // the other — counting `users` would have charged both plans for the
    // same login (PLAN.md §13 H6, revisited with §3.1).
    return countTenantMembers(tenantId);
  }

  if (key === "maxContacts") {
    const [row] = await db
      .select({ value: count() })
      .from(contacts)
      .where(eq(contacts.tenantId, tenantId));
    return row?.value ?? 0;
  }

  if (key === "maxEmailsPerDay") {
    const ctx = await buildSystemTenantContext(tenantId);
    return ctx ? countEmailsSentToday(ctx) : 0;
  }

  const [row] = await db
    .select({ value: count() })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)));
  return row?.value ?? 0;
}

/**
 * Whether one more of `key` fits inside the tenant's plan.
 *
 * `additional` is what the caller is about to create — an import of 500 rows
 * asks once for 500 rather than 500 times for one.
 */
export async function checkPlanLimit(
  tenantId: string,
  key: LimitKey,
  additional = 1,
): Promise<LimitCheck> {
  const limits = await getTenantLimits(tenantId);
  const limit = limits[key] ?? null;
  if (limit === null) return UNLIMITED;

  const current = await currentUsage(tenantId, key);
  return { allowed: current + additional <= limit, limit, current };
}

/** Thrown by services that must not create past the plan; actions catch it
 * and render the limit-reached copy instead of the generic error. */
export class PlanLimitError extends Error {
  constructor(
    readonly key: LimitKey,
    readonly check: LimitCheck,
  ) {
    super(`plan_limit_reached:${key}`);
  }
}

export async function assertPlanLimit(
  ctx: TenantContext,
  key: LimitKey,
  additional = 1,
): Promise<void> {
  const check = await checkPlanLimit(ctx.tenantId, key, additional);
  if (!check.allowed) throw new PlanLimitError(key, check);
}
