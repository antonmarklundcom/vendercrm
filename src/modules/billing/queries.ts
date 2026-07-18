import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { plans, subscriptions } from "@/db/schema/tenancy";
import { getSuperadminContext } from "@/modules/tenancy/context";

export async function listPlans() {
  await getSuperadminContext();
  return db.select().from(plans);
}

export async function listActivePlans() {
  await getSuperadminContext();
  return db.select().from(plans).where(eq(plans.isActive, true));
}

export async function listTenantSubscriptions(tenantId: string) {
  await getSuperadminContext();
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.expiresAt));
}
