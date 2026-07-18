import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { tenants } from "@/db/schema/tenancy";
import { waAccounts, webhookEvents } from "@/db/schema/whatsapp";
import { getSuperadminContext } from "@/modules/tenancy/context";

export async function listWaAccountsAcrossTenants() {
  await getSuperadminContext();

  const accounts = await db.select().from(waAccounts);
  const tenantIds = [...new Set(accounts.map((a) => a.tenantId))];
  const tenantRows =
    tenantIds.length > 0 ? await db.select().from(tenants).where(inArray(tenants.id, tenantIds)) : [];
  const tenantsById = new Map(tenantRows.map((t) => [t.id, t]));

  return accounts.map((a) => ({ ...a, tenantName: tenantsById.get(a.tenantId)?.name ?? "?" }));
}

export async function listRecentFailedWebhookEvents(limit = 50) {
  await getSuperadminContext();

  return db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "failed"))
    .orderBy(desc(webhookEvents.createdAt))
    .limit(limit);
}
