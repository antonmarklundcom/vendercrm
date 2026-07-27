import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, webhookEvents } from "@/db/schema";
import { enqueue } from "@/lib/queue";
import { reportEvent } from "@/lib/observability";

// webhook_events pruning (PLAN.md §4: "pruned after 30 days"; §10 1H).
// The table exists for replay and debugging, so it grows with every inbound
// WhatsApp message and would otherwise be the fastest-growing table in the
// database.

export const RETENTION_DAYS = 30;
export const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Platform-wide by nature: webhook_events has no tenant_id (§4), because
 * events arrive before routing and unrecognised ones never get a tenant at
 * all. Failed events are kept regardless of age — they are exactly the ones
 * worth looking at, and the superadmin health view lists them.
 */
export async function pruneWebhookEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(webhookEvents)
    .where(and(lt(webhookEvents.createdAt, cutoff), eq(webhookEvents.status, "processed")));

  const deleted = (result as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
  reportEvent("webhook_events.pruned", { deleted, cutoff: cutoff.toISOString() });
  return deleted;
}

/**
 * Seeds the recurring prune; the job re-enqueues itself after each run.
 * Called on every worker boot, so it first checks for an already-scheduled
 * prune — otherwise each restart would add another chain and the table
 * would be swept several times a day by an ever-growing number of jobs.
 */
export async function schedulePrune(delayMs = 0) {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, "whatsapp.prune_events"), inArray(jobs.status, ["pending", "running"])))
    .limit(1);
  if (pending.length > 0) return;

  await enqueue("whatsapp.prune_events", {}, { runAt: new Date(Date.now() + delayMs) });
}
