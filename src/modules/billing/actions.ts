"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { payments, plans, subscriptions, tenants } from "@/db/schema/tenancy";
import { writeAuditLog } from "@/modules/audit/log";
import { getSuperadminContext } from "@/modules/tenancy/context";

export async function createPlan(input: {
  name: string;
  durationMonths: number;
  price: number;
  currency?: string;
}): Promise<void> {
  const superadmin = await getSuperadminContext();

  const [inserted] = await db
    .insert(plans)
    .values({
      name: input.name,
      durationMonths: input.durationMonths,
      price: input.price,
      currency: input.currency ?? "PYG",
    })
    .$returningId();

  await writeAuditLog({
    actorUserId: superadmin.userId,
    action: "plan.create",
    entity: "plan",
    entityId: inserted.id,
    payload: input,
  });

  revalidatePath("/superadmin/plans");
}

export async function recordPayment(input: {
  tenantId: string;
  planId: string;
  amount: number;
  currency?: string;
  method: "transfer" | "cash" | "other";
  reference?: string;
  notes?: string;
}): Promise<void> {
  const superadmin = await getSuperadminContext();

  const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
  if (!plan) throw new Error("Plan not found");

  const [latestSubscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, input.tenantId))
    .orderBy(desc(subscriptions.expiresAt))
    .limit(1);

  const now = new Date();
  const startsAt =
    latestSubscription && latestSubscription.expiresAt > now ? latestSubscription.expiresAt : now;
  const expiresAt = new Date(startsAt);
  expiresAt.setMonth(expiresAt.getMonth() + plan.durationMonths);

  const [insertedSub] = await db
    .insert(subscriptions)
    .values({
      tenantId: input.tenantId,
      planId: input.planId,
      startsAt,
      expiresAt,
      status: "active",
    })
    .$returningId();

  const [insertedPayment] = await db
    .insert(payments)
    .values({
      subscriptionId: insertedSub.id,
      amount: input.amount,
      currency: input.currency ?? plan.currency,
      method: input.method,
      reference: input.reference,
      recordedByUserId: superadmin.userId,
      notes: input.notes,
    })
    .$returningId();

  await db.update(tenants).set({ status: "active" }).where(eq(tenants.id, input.tenantId));

  await writeAuditLog({
    tenantId: input.tenantId,
    actorUserId: superadmin.userId,
    action: "payment.record",
    entity: "payment",
    entityId: insertedPayment.id,
    payload: { subscriptionId: insertedSub.id, amount: input.amount, planId: input.planId },
  });

  revalidatePath(`/superadmin/tenants/${input.tenantId}`);
}
