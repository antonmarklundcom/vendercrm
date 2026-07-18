import { registerHandler } from "@/worker/handlers";
import { getWebhookEvent, markWebhookEvent } from "./platform";
import { processWebhookPayload, UnknownAccountError } from "./processing";
import { WHATSAPP_SEND, deliverSendJob } from "./send";

// Self-registers on import. The worker imports this module at startup so the
// handlers are live before any job is claimed.

export const WHATSAPP_PROCESS_WEBHOOK = "whatsapp.process_webhook";

registerHandler(WHATSAPP_PROCESS_WEBHOOK, async (payload) => {
  const { webhookEventId } = payload as { webhookEventId: string };
  const event = await getWebhookEvent(webhookEventId);
  if (!event || event.status === "processed") return;

  try {
    await processWebhookPayload(event.payload);
    await markWebhookEvent(webhookEventId, "processed");
  } catch (err) {
    // Unknown account / unparseable payload won't fix on retry — mark failed
    // terminally and return so the job completes (PLAN.md §6.3 rule 4).
    if (err instanceof UnknownAccountError) {
      await markWebhookEvent(webhookEventId, "failed", err.message);
      return;
    }
    // Transient (DB blip, media fetch): record the error but rethrow so the
    // queue retries with backoff. The event stays claimable until it succeeds
    // or dead-letters.
    await markWebhookEvent(
      webhookEventId,
      "failed",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
});

registerHandler(WHATSAPP_SEND, async (payload, tenantId) => {
  await deliverSendJob(payload, tenantId);
});
