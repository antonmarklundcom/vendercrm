import { db } from "@/db/client";
import { webhookEvents } from "@/db/schema/whatsapp";
import { enqueue } from "@/lib/queue/enqueue";

/**
 * The only job of this function is to persist the raw event and enqueue
 * processing — no business logic, no tenant resolution here. Meta retries on
 * slow/non-200 responses and eventually pauses the subscription on
 * persistent failure, so the webhook route must return fast (PLAN.md §6.3).
 */
export async function recordWebhookEvent(
  phoneNumberId: string | null,
  payload: unknown,
): Promise<void> {
  const [inserted] = await db
    .insert(webhookEvents)
    .values({ phoneNumberId, payload })
    .$returningId();

  await enqueue("whatsapp.process_webhook_event", { webhookEventId: inserted.id });
}
