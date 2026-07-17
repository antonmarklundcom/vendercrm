import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { plans, subscriptions, payments } from "@/db/schema";
import { newId } from "@/lib/ids";

// Platform-level billing. Prepay-only, manual collection in Phase 1: a
// superadmin records a payment (transfer/cash) which extends the tenant's
// subscription expiry. No payment gateway (PLAN.md §1.2, §1B).

export const GRACE_PERIOD_DAYS = 7;

export type EffectiveStatus = "active" | "grace" | "expired";

// Derives the real access state from expiry + a fixed grace window, independent
// of the stored `status` column (which is updated lazily). The middleware uses
// this to gate the tenant app: active → full; grace → read-only banner;
// expired → locked (PLAN.md §1B).
export function effectiveSubscriptionStatus(
  sub: { expiresAt: Date },
  now: Date = new Date(),
): EffectiveStatus {
  const expiry = sub.expiresAt.getTime();
  if (now.getTime() <= expiry) return "active";
  const graceEnds = expiry + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() <= graceEnds) return "grace";
  return "expired";
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// --- Plans -------------------------------------------------------------------

export async function listPlans() {
  return db.select().from(plans).orderBy(plans.durationMonths);
}

export async function createPlan(input: {
  name: string;
  durationMonths: number;
  price: number;
  currency?: string;
  limits?: unknown;
  features?: unknown;
}): Promise<string> {
  const id = newId();
  await db.insert(plans).values({
    id,
    name: input.name,
    durationMonths: input.durationMonths,
    price: input.price,
    currency: input.currency ?? "PYG",
    limits: (input.limits as object) ?? null,
    features: (input.features as object) ?? null,
  });
  return id;
}

export async function setPlanActive(
  planId: string,
  isActive: boolean,
): Promise<void> {
  await db.update(plans).set({ isActive }).where(eq(plans.id, planId));
}

// --- Subscriptions & payments ------------------------------------------------

export async function getSubscription(tenantId: string) {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return sub ?? null;
}

export async function listPayments(subscriptionId: string) {
  return db
    .select()
    .from(payments)
    .where(eq(payments.subscriptionId, subscriptionId))
    .orderBy(desc(payments.createdAt));
}

/**
 * Record a manual payment and extend the tenant's subscription by the plan's
 * duration. Creates the subscription if the tenant has none yet. Expiry is
 * extended from whichever is later — now or the current expiry — so early
 * renewals stack rather than truncating remaining time. Runs in one
 * transaction so the ledger row and the expiry move together.
 */
export async function recordPayment(input: {
  tenantId: string;
  planId: string;
  amount: number;
  currency?: string;
  method: "transfer" | "cash" | "other";
  reference?: string;
  notes?: string;
  recordedByUserId: string;
}): Promise<{ subscriptionId: string; expiresAt: Date }> {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(plans)
      .where(eq(plans.id, input.planId))
      .limit(1);
    if (!plan) throw new Error("Plan no encontrado");

    const [existing] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, input.tenantId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    const now = new Date();
    let subscriptionId: string;
    let newExpiry: Date;

    if (existing) {
      const base = existing.expiresAt > now ? existing.expiresAt : now;
      newExpiry = addMonths(base, plan.durationMonths);
      subscriptionId = existing.id;
      await tx
        .update(subscriptions)
        .set({ planId: plan.id, expiresAt: newExpiry, status: "active" })
        .where(eq(subscriptions.id, existing.id));
    } else {
      newExpiry = addMonths(now, plan.durationMonths);
      subscriptionId = newId();
      await tx.insert(subscriptions).values({
        id: subscriptionId,
        tenantId: input.tenantId,
        planId: plan.id,
        startsAt: now,
        expiresAt: newExpiry,
        status: "active",
      });
    }

    await tx.insert(payments).values({
      id: newId(),
      subscriptionId,
      amount: input.amount,
      currency: input.currency ?? plan.currency,
      method: input.method,
      reference: input.reference,
      notes: input.notes,
      recordedByUserId: input.recordedByUserId,
    });

    return { subscriptionId, expiresAt: newExpiry };
  });
}

export async function findActiveTenantIds() {
  // Used by tests/console; not tenant-scoped (platform view).
  return db
    .select({ tenantId: subscriptions.tenantId, expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active")));
}
