import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { webhookEvents, waAccounts, conversations, messages } from "@/db/schema/whatsapp";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/context";
import { normalizePhonePY } from "@/lib/phone";
import { storage } from "@/lib/storage";
import { crmEvents } from "@/modules/crm/events";
import {
  extractChangeValues,
  mediaFieldFor,
  type InboundMessage,
  type WhatsAppChangeValue,
} from "./webhook-types";
import { downloadMedia, fetchMediaUrl } from "./graph-api";
import { getDecryptedAccessToken } from "./queries";
import { upsertContactByPhone } from "@/modules/crm/contact-upsert";

/** A trusted, worker-internal context — never derived from a user session. */
function systemContext(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: "system",
    role: "admin",
    isImpersonating: false,
    actorUserId: "system",
  };
}

async function markEvent(id: string, status: "processed" | "failed", error?: string): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status, error: error?.slice(0, 2000) })
    .where(eq(webhookEvents.id, id));
}

export async function processWebhookEvent(webhookEventId: string): Promise<void> {
  const [event] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, webhookEventId))
    .limit(1);

  if (!event) return; // nothing to do — shouldn't happen, not worth retrying

  if (!event.phoneNumberId) {
    await markEvent(event.id, "failed", "No phone_number_id in payload");
    return;
  }

  const [account] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.phoneNumberId, event.phoneNumberId))
    .limit(1);

  if (!account) {
    await markEvent(event.id, "failed", `No wa_account for phone_number_id ${event.phoneNumberId}`);
    return;
  }

  const ctx = systemContext(account.tenantId);
  const changeValues = extractChangeValues(event.payload);

  for (const value of changeValues) {
    await processChangeValue(ctx, account, value);
  }

  await markEvent(event.id, "processed");
}

async function processChangeValue(
  ctx: TenantContext,
  account: typeof waAccounts.$inferSelect,
  value: WhatsAppChangeValue,
): Promise<void> {
  for (const message of value.messages ?? []) {
    const profileName = value.contacts?.find((c) => c.wa_id === message.from)?.profile.name;
    await processInboundMessage(ctx, account, message, profileName);
  }

  for (const statusUpdate of value.statuses ?? []) {
    const scoped = tenantDb(ctx);
    const [existing] = await scoped.findMany(messages, eq(messages.waMessageId, statusUpdate.id));

    if (existing) {
      await scoped.update(
        messages,
        {
          status: statusUpdate.status,
          error: statusUpdate.errors ? { errors: statusUpdate.errors } : null,
        },
        eq(messages.id, existing.id),
      );
    }
  }
}

async function processInboundMessage(
  ctx: TenantContext,
  account: typeof waAccounts.$inferSelect,
  message: InboundMessage,
  profileName: string | undefined,
): Promise<void> {
  const scoped = tenantDb(ctx);

  // Idempotency guard — Meta redelivers webhooks; duplicates must be no-ops.
  const [existingMessage] = await scoped.findMany(messages, eq(messages.waMessageId, message.id));
  if (existingMessage) return;

  const phone = normalizePhonePY(message.from);
  const contact = await upsertContactByPhone(ctx, {
    phone,
    name: profileName ?? phone,
    source: "whatsapp",
  });

  const [existingConversation] = await scoped.findMany(
    conversations,
    and(eq(conversations.waAccountId, account.id), eq(conversations.contactId, contact.id)),
  );

  const now = new Date();
  let conversationId: string;

  if (existingConversation) {
    conversationId = existingConversation.id;
    await scoped.update(
      conversations,
      {
        status: "open",
        lastMessageAt: now,
        lastInboundAt: now,
        unreadCount: existingConversation.unreadCount + 1,
      },
      eq(conversations.id, conversationId),
    );
  } else {
    const [inserted] = await scoped
      .insert(conversations, {
        waAccountId: account.id,
        contactId: contact.id,
        status: "open",
        lastMessageAt: now,
        lastInboundAt: now,
        unreadCount: 1,
      })
      .$returningId();
    conversationId = inserted.id;
  }

  const { type, body, mediaStorageKey, mediaMimeType } = await resolveMessageContent(
    ctx,
    account,
    message,
  );

  await scoped.insert(messages, {
    conversationId,
    direction: "in",
    waMessageId: message.id,
    type,
    body: body ?? null,
    mediaStorageKey: mediaStorageKey ?? null,
    mediaMimeType: mediaMimeType ?? null,
    status: "delivered",
  });

  await crmEvents.emit("contact.created", { tenantId: ctx.tenantId, contactId: contact.id });
}

async function resolveMessageContent(
  ctx: TenantContext,
  account: typeof waAccounts.$inferSelect,
  message: InboundMessage,
): Promise<{
  type: (typeof messages.$inferSelect)["type"];
  body?: string;
  mediaStorageKey?: string;
  mediaMimeType?: string;
}> {
  if (message.type === "text" && message.text) {
    return { type: "text", body: message.text.body };
  }

  const mediaField = mediaFieldFor(message);
  if (mediaField) {
    const media = message[mediaField]!;

    try {
      const accessToken = getDecryptedAccessToken(account);
      const { url, mime_type } = await fetchMediaUrl(media.id, accessToken);
      const data = await downloadMedia(url, accessToken);
      const key = `whatsapp/${ctx.tenantId}/${message.id}`;
      await storage.put(key, data, mime_type);

      return {
        type: mediaField,
        body: media.caption,
        mediaStorageKey: key,
        mediaMimeType: mime_type,
      };
    } catch {
      // Media fetch failed (expired URL, network issue) — keep the message
      // as a record with the caption/type but no stored file, rather than
      // failing the whole webhook event over one attachment.
      return { type: mediaField, body: media.caption };
    }
  }

  return { type: "unsupported" };
}
