import { registerHandler } from "@/worker/handlers";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { processWebhookEvent } from "./webhook";
import { deliverQueuedMessage } from "./send";
import { syncTemplates } from "./templates";
import { scheduleTemplateSync, SYNC_INTERVAL_MS } from "./sync-schedule";
import { pruneWebhookEvents, schedulePrune, PRUNE_INTERVAL_MS } from "./pruning";

// Job handlers for the WhatsApp pipeline (PLAN.md §6.3, §6.4). Imported for
// its registration side effect from worker/handlers.ts, same pattern as
// the built-in queue.test handler.

registerHandler("whatsapp.process_event", async (payload) => {
  const { eventId } = payload as { eventId: string };
  await processWebhookEvent(eventId);
});

registerHandler("whatsapp.send", async (payload, tenantId) => {
  if (!tenantId) throw new Error("whatsapp.send job missing tenantId");
  const { messageId, graphPayload } = payload as {
    messageId: string;
    graphPayload: Record<string, unknown>;
  };
  await deliverQueuedMessage(tenantId, messageId, graphPayload);
});

// Nightly template sync (§6.4). Re-enqueues itself only after the sync
// succeeds, so a retry storm can't fan out into duplicate chains — see
// scheduleTemplateSync's comment for why a failed chain is allowed to end.
registerHandler("whatsapp.sync_templates", async (payload, tenantId) => {
  if (!tenantId) throw new Error("whatsapp.sync_templates job missing tenantId");
  const { accountId } = payload as { accountId: string };

  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return;

  await syncTemplates(ctx, accountId);
  await scheduleTemplateSync(ctx, accountId, SYNC_INTERVAL_MS);
});

// Daily pruning of webhook_events. Unlike the template sync this has no
// tenant, so it re-enqueues itself unconditionally — there is no per-tenant
// token that could break the chain.
registerHandler("whatsapp.prune_events", async () => {
  await pruneWebhookEvents();
  await schedulePrune(PRUNE_INTERVAL_MS);
});
