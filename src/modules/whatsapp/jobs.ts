import { eq } from "drizzle-orm";
import { registerJobHandler } from "@/lib/queue/handlers";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/context";
import { waAccounts, messages } from "@/db/schema/whatsapp";
import { processWebhookEvent } from "./webhook-process";
import { GraphApiError, sendWhatsAppMessage, type OutboundMessagePayload } from "./graph-api";
import { getDecryptedAccessToken } from "./queries";

registerJobHandler("whatsapp.process_webhook_event", async (payload) => {
  const { webhookEventId } = payload as { webhookEventId: string };
  await processWebhookEvent(webhookEventId);
});

function systemContext(tenantId: string): TenantContext {
  return { tenantId, userId: "system", role: "admin", isImpersonating: false, actorUserId: "system" };
}

registerJobHandler("whatsapp.send_message", async (payload) => {
  const { tenantId, messageId, waAccountId, to, payload: graphPayload } = payload as {
    tenantId: string;
    messageId: string;
    waAccountId: string;
    to: string;
    payload: OutboundMessagePayload;
  };

  const scoped = tenantDb(systemContext(tenantId));

  const account = await scoped.findFirst(waAccounts, eq(waAccounts.id, waAccountId));
  if (!account) {
    await scoped.update(messages, { status: "failed", error: { message: "wa_account not found" } }, eq(messages.id, messageId));
    return;
  }

  try {
    const accessToken = getDecryptedAccessToken(account);
    const result = await sendWhatsAppMessage(account.phoneNumberId, accessToken, to, graphPayload);
    const waMessageId = result.messages?.[0]?.id;

    await scoped.update(
      messages,
      { status: "sent", waMessageId: waMessageId ?? null },
      eq(messages.id, messageId),
    );
  } catch (error) {
    const isRetryable =
      !(error instanceof GraphApiError) || error.status >= 500 || error.status === 429;

    await scoped.update(
      messages,
      {
        status: "failed",
        error: { message: error instanceof Error ? error.message : String(error) },
      },
      eq(messages.id, messageId),
    );

    if (isRetryable) throw error;
  }
});
