import { registerHandler } from "@/worker/handlers";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { processWebhookEvent } from "./webhook";
import { deliverQueuedMessage } from "./send";
import { syncTemplates } from "./templates";
import { scheduleTemplateSync, SYNC_INTERVAL_MS } from "./sync-schedule";
import { TRANSCRIBE_JOB_TYPE, transcribeMessage } from "./transcription";
import { whatsappEvents } from "./events";
import { reportError } from "@/lib/observability";

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

// Voice-note transcription (§15.3 Lane A, §15.10 W1). The handler always
// emits `wa.message_transcribed` before it returns or rethrows on its last
// attempt, because the automation chain for this message is parked on that
// event — a voice note that cannot be transcribed still has to reach the
// flows, the opt-out check and the handoff keyword, just without words.
registerHandler(TRANSCRIBE_JOB_TYPE, async (payload, tenantId) => {
  if (!tenantId) throw new Error("whatsapp.transcribe job missing tenantId");
  const { messageId, conversationId, contactId } = payload as {
    messageId: string;
    conversationId: string;
    contactId: string;
  };

  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return;

  const announce = () =>
    whatsappEvents.emit("wa.message_transcribed", {
      tenantId,
      conversationId,
      contactId,
      messageId,
    });

  try {
    await transcribeMessage(ctx, messageId);
  } catch (err) {
    // The row already says `failed` with the reason (transcribeMessage
    // writes it before rethrowing). Rethrowing here is what buys the retry;
    // the chain is released only once the queue has stopped retrying, so a
    // transient provider blip does not answer the customer wordlessly.
    if (await isLastAttempt(messageId)) await announce();
    throw err;
  }

  // The owner asking their own number what is pending (§15.3 Lane A, second
  // half). Before the chain is released and best-effort: an unanswerable
  // coach question must not hold up, or fail, the ordinary inbound handling.
  try {
    const { maybeAnswerCoachVoiceNote } = await import("@/modules/coach/voice");
    await maybeAnswerCoachVoiceNote(ctx, { messageId, conversationId, contactId });
  } catch (err) {
    reportError(err, {
      tags: { area: "coach", jobType: TRANSCRIBE_JOB_TYPE },
      extra: { messageId, tenantId },
    });
  }

  // Terminal either way — `done`, or a `skipped` the row explains — so the
  // chain runs now.
  await announce();
});

/**
 * Whether the job row for this message has no attempts left. Read from the
 * queue rather than passed in the payload, because the payload is written
 * once and the attempt count is what changes.
 */
async function isLastAttempt(messageId: string): Promise<boolean> {
  const { db } = await import("@/db/client");
  const { jobs } = await import("@/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const rows = await db
    .select({ attempts: jobs.attempts, maxAttempts: jobs.maxAttempts })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, TRANSCRIBE_JOB_TYPE),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${jobs.payload}, '$.messageId')) = ${messageId}`,
      ),
    )
    .limit(1);
  const row = rows[0];
  return !row || row.attempts + 1 >= row.maxAttempts;
}
