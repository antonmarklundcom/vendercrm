import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { waAccounts, webhookEvents } from "@/db/schema";
import { newId } from "@/lib/ids";

// Platform-level WhatsApp operations that run WITHOUT a tenant context — the
// webhook entry point resolves which tenant a phone_number_id belongs to, and
// the raw event log has no tenant scope. This file is on the raw-`db` allowlist
// (PLAN.md §3.3); everything else in the module goes through tenantDb.

// Route an inbound webhook: phone_number_id → the owning account (+ its
// tenant). Unknown ids return null so the processor can mark the event failed
// without crashing (PLAN.md §6.3, rule 4).
export async function getAccountByPhoneNumberId(phoneNumberId: string) {
  const [row] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.phoneNumberId, phoneNumberId))
    .limit(1);
  return row ?? null;
}

export async function recordWebhookEvent(input: {
  phoneNumberId: string | null;
  payload: unknown;
}): Promise<string> {
  const id = newId();
  await db.insert(webhookEvents).values({
    id,
    phoneNumberId: input.phoneNumberId,
    payload: input.payload as object,
    status: "received",
  });
  return id;
}

export async function getWebhookEvent(id: string) {
  const [row] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id))
    .limit(1);
  return row ?? null;
}

export async function markWebhookEvent(
  id: string,
  status: "processed" | "failed",
  error?: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status, error: error ?? null, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(webhookEvents.id, id));
}

// Superadmin WhatsApp health view (PLAN.md §6.5): recent failed events.
export async function listFailedWebhookEvents(limit = 50) {
  return db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "failed"))
    .orderBy(sql`${webhookEvents.createdAt} DESC`)
    .limit(limit);
}

export async function listAllAccounts() {
  return db.select().from(waAccounts);
}
