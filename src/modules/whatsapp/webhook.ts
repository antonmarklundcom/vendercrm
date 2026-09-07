import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { webhookEvents, messages as messagesTable, conversations } from "@/db/schema";
import { newId } from "@/lib/ids";
import { env } from "@/lib/config/env";
import { storage } from "@/lib/storage";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { createContact, getContactByPhone } from "@/modules/crm/contacts";
import { resolveAccountByPhoneNumberId, getDecryptedAccessToken } from "./accounts";
import { GRAPH_API_BASE, GRAPH_TIMEOUT_MS, MEDIA_DOWNLOAD_TIMEOUT_MS } from "./graph";
import { whatsappEvents } from "./events";
import { inboundMessageTime, latest } from "./inbound-time";
import { advanceNotificationForMessage } from "@/modules/booking/notifications";
import { advancesMessageStatus, type MessageStatus } from "./message-status";
import { reportError } from "@/lib/observability";

// Webhook ingestion (PLAN.md §6.3, reliability-critical). The route handler
// (app/api/webhooks/whatsapp/route.ts) does only steps 1-2 — verify
// signature, persist raw + enqueue + return 200 fast. Everything else (this
// file) runs as a job, off the request path.


/** Step 1: HMAC-SHA256 over the *raw* request body, app-secret keyed. */
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

const webhookValueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string() }),
  contacts: z
    .array(z.object({ profile: z.object({ name: z.string().optional() }).optional(), wa_id: z.string() }))
    .optional(),
  messages: z
    .array(
      z.object({
        from: z.string(),
        id: z.string(),
        timestamp: z.string(),
        type: z.string(),
        text: z.object({ body: z.string() }).optional(),
        image: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
        document: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
        audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
        video: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
        // A tapped reply button or list row. `id` is ours — we put it on the
        // row when the options were sent (modules/booking/whatsapp-booking).
        interactive: z
          .object({
            type: z.string().optional(),
            button_reply: z.object({ id: z.string(), title: z.string().optional() }).optional(),
            list_reply: z.object({ id: z.string(), title: z.string().optional() }).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  statuses: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["sent", "delivered", "read", "failed"]),
        errors: z.array(z.unknown()).optional(),
      }),
    )
    .optional(),
});

const webhookPayloadSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z.array(z.object({ value: webhookValueSchema, field: z.string().optional() })),
      }),
    )
    .optional(),
});

/** Step 2: persist-first — always succeeds even if the payload turns out
 * unparseable, so nothing is ever lost (§6.3 rule 2). */
export async function persistRawEvent(payload: unknown, phoneNumberId: string | null) {
  const id = newId();
  await db.insert(webhookEvents).values({ id, payload: payload as object, phoneNumberId });
  return id;
}

async function markEvent(id: string, status: "processed" | "failed", error?: string) {
  await db
    .update(webhookEvents)
    .set({ status, error: error?.slice(0, 2000) })
    .where(eq(webhookEvents.id, id));
}

/** Step 3-4: the actual processing, run as a job (whatsapp.process_event). */
export async function processWebhookEvent(eventId: string): Promise<void> {
  const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
  if (!event) return;

  const parsed = webhookPayloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    await markEvent(eventId, "failed", `Unparseable payload: ${parsed.error.message}`);
    return;
  }

  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes) {
      await processValue(eventId, change.value);
    }
  }
}

async function processValue(eventId: string, value: z.infer<typeof webhookValueSchema>) {
  const account = await resolveAccountByPhoneNumberId(value.metadata.phone_number_id);
  if (!account) {
    await markEvent(eventId, "failed", `Unknown phone_number_id: ${value.metadata.phone_number_id}`);
    return;
  }

  const ctx = await buildSystemTenantContext(account.tenantId);
  if (!ctx) {
    await markEvent(eventId, "failed", `Tenant ${account.tenantId} not found`);
    return;
  }

  for (const message of value.messages ?? []) {
    await ingestInboundMessage(ctx, account, message, value.contacts);
  }

  for (const status of value.statuses ?? []) {
    // Read before writing: Meta redelivers, and status events can arrive out
    // of order, so a blind update can walk a message backwards from `read`
    // to `sent`. See ./message-status.ts.
    const [message] = await tenantDb(ctx).select(
      messagesTable,
      eq(messagesTable.waMessageId, status.id),
    );
    if (!message) continue;
    if (!advancesMessageStatus(message.status as MessageStatus, status.status)) continue;

    await tenantDb(ctx)
      .update(messagesTable)
      .set({ status: status.status, error: status.errors ? { errors: status.errors } : null })
      .where(eq(messagesTable.waMessageId, status.id));

    // A booking notice sent over WhatsApp is *this* message. Mirroring the
    // status onto its notification row is what lets the booking timeline say
    // "entregado" instead of stopping at "enviado" — the distinction staff
    // actually argue about when a customer says nobody told them.
    await advanceNotificationForMessage(ctx, message.id, status.status);
  }

  await markEvent(eventId, "processed");
}

async function ingestInboundMessage(
  ctx: TenantContext,
  account: NonNullable<Awaited<ReturnType<typeof resolveAccountByPhoneNumberId>>>,
  message: NonNullable<z.infer<typeof webhookValueSchema>["messages"]>[number],
  contactsMeta: z.infer<typeof webhookValueSchema>["contacts"],
) {
  // Idempotency guard (§6.3 rule 3): Meta redelivers, duplicates must be
  // no-ops. Checked first (single-process worker, §2.1) and enforced again
  // by the DB unique index if a race ever slips through.
  const [existing] = await tenantDb(ctx).select(
    messagesTable,
    eq(messagesTable.waMessageId, message.id),
  );
  if (existing) return;

  const phone = message.from.startsWith("+") ? message.from : `+${message.from}`;
  const name = contactsMeta?.find((c) => c.wa_id === message.from)?.profile?.name;

  let contact = await getContactByPhone(ctx, phone);
  if (!contact) {
    contact = await createContact(ctx, { name: name || phone, phone, source: "whatsapp" });
  }
  if (!contact) return;

  let conversation = (
    await tenantDb(ctx).select(
      conversations,
      eq(conversations.contactId, contact.id),
    )
  ).find((c) => c.waAccountId === account.id);

  // The 24h window runs from when the customer sent the message, not from
  // when this job happened to process it — see ./inbound-time.ts for why the
  // difference is load-bearing rather than cosmetic.
  const receivedAt = new Date();
  const sentAt = inboundMessageTime(message.timestamp, receivedAt);

  if (!conversation) {
    const conversationId = newId();
    await tenantDb(ctx)
      .insert(conversations)
      .values({
        id: conversationId,
        waAccountId: account.id,
        contactId: contact.id,
        status: "open",
        lastMessageAt: sentAt,
        lastInboundAt: sentAt,
        unreadCount: 1,
      });
    const [row] = await tenantDb(ctx).select(conversations, eq(conversations.id, conversationId));
    conversation = row;
  } else {
    await tenantDb(ctx)
      .update(conversations)
      .set({
        status: "open",
        lastMessageAt: latest(conversation.lastMessageAt, sentAt),
        lastInboundAt: latest(conversation.lastInboundAt, sentAt),
        unreadCount: conversation.unreadCount + 1,
      })
      .where(eq(conversations.id, conversation.id));
  }
  if (!conversation) return;

  const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;

  const messageType = ["text", "image", "document", "audio", "video"].includes(message.type)
    ? (message.type as "text" | "image" | "document" | "audio" | "video")
    : message.type === "interactive" && reply
      ? ("interactive" as const)
      : "unsupported";

  const mediaRef = message.image ?? message.document ?? message.audio ?? message.video;
  let storageKey: string | undefined;
  if (mediaRef && (messageType === "image" || messageType === "document" || messageType === "audio" || messageType === "video")) {
    storageKey = await downloadMedia(account, mediaRef.id, messageType).catch((error) => {
      // Inbound webhooks must stay resilient (§6.3): a rejected/oversized/
      // disallowed-type attachment should never take the handler down or
      // lose the message it arrived on — it just arrives with no media.
      reportError(error, {
        tags: { scope: "whatsapp.inbound_media", tenantId: ctx.tenantId, mediaType: messageType },
        extra: { mediaId: mediaRef.id },
      });
      return undefined;
    });
  }

  const messageId = newId();
  await tenantDb(ctx)
    .insert(messagesTable)
    .values({
      id: messageId,
      conversationId: conversation.id,
      direction: "in",
      waMessageId: message.id,
      type: messageType,
      // The *title* the customer saw, not the opaque id: a rep scrolling the
      // thread should read "lun 7, 09:00", not "bk:01J…:1789…".
      body: message.text?.body ?? reply?.title ?? undefined,
      mediaId: mediaRef?.id,
      storageKey,
      status: "delivered",
      // Stamped from Meta's timestamp too, so a thread read after a backlog
      // shows when the customer wrote, not when the queue caught up.
      createdAt: sentAt,
    });

  await whatsappEvents.emit("wa.message_received", {
    tenantId: ctx.tenantId,
    conversationId: conversation.id,
    contactId: contact.id,
    messageId,
  });

  // A tapped slot is a booking (plan-booking.md §5.3). Handled after the
  // message is persisted and the event has fired, so the thread reads in the
  // right order and an automation still sees the customer's reply — and
  // handled *last*, because a failure to reserve must not lose the inbound
  // message that is already safely written.
  if (reply) {
    const { handleSlotTap } = await import("@/modules/booking/whatsapp-booking");
    await handleSlotTap(ctx, {
      conversationId: conversation.id,
      contactId: contact.id,
      replyId: reply.id,
    });
  }
}

export type InboundMediaType = "image" | "document" | "audio" | "video";

/**
 * Meta's documented per-type caps for media *sent to* a WhatsApp user
 * (Cloud API "Supported Media Types"). We apply the same caps to *inbound*
 * media, since Meta itself never delivers anything larger — anything past
 * this is either a misbehaving/compromised sender or a corrupted transfer,
 * and either way we don't want it in storage.
 */
export const WHATSAPP_MEDIA_LIMITS: Record<
  InboundMediaType,
  { maxBytes: number; mimeTypes: readonly string[] }
> = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png"],
  },
  audio: {
    maxBytes: 16 * 1024 * 1024,
    mimeTypes: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
  },
  video: {
    maxBytes: 16 * 1024 * 1024,
    mimeTypes: ["video/mp4", "video/3gpp"],
  },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: [
      "text/plain",
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
};

/** Pure so it's cheap to unit-test without touching fetch/storage. */
export function validateInboundMedia(
  type: InboundMediaType,
  mimeType: string | undefined,
  sizeBytes: number,
): { ok: true } | { ok: false; reason: string } {
  const limit = WHATSAPP_MEDIA_LIMITS[type];

  if (!mimeType || !limit.mimeTypes.includes(mimeType)) {
    return { ok: false, reason: `Disallowed MIME type for ${type}: ${mimeType ?? "(missing)"}` };
  }
  if (sizeBytes > limit.maxBytes) {
    return { ok: false, reason: `${type} of ${sizeBytes} bytes exceeds ${limit.maxBytes} byte cap` };
  }
  return { ok: true };
}

/** Media URLs Meta returns expire quickly — fetch immediately (§6.3 rule 3). */
export async function downloadMedia(
  account: NonNullable<Awaited<ReturnType<typeof resolveAccountByPhoneNumberId>>>,
  mediaId: string,
  type: InboundMediaType,
): Promise<string> {
  const token = getDecryptedAccessToken(account);

  const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  });
  if (!metaRes.ok) throw new Error(`Media metadata fetch failed: ${metaRes.status}`);
  const meta = (await metaRes.json()) as { url: string; mime_type?: string; file_size?: number };

  // Meta's own metadata reports the size before we pull the bytes — reject
  // up front rather than downloading a body we're going to throw away.
  const declaredSize = typeof meta.file_size === "number" ? meta.file_size : 0;
  const declaredCheck = validateInboundMedia(type, meta.mime_type, declaredSize);
  if (!declaredCheck.ok) throw new Error(declaredCheck.reason);

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
  });
  if (!fileRes.ok) throw new Error(`Media download failed: ${fileRes.status}`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  // Defense in depth: `file_size` can be absent, and content can't be
  // trusted to match what the metadata call claimed.
  const finalCheck = validateInboundMedia(type, meta.mime_type, buffer.byteLength);
  if (!finalCheck.ok) throw new Error(finalCheck.reason);

  const key = `whatsapp-media/${account.tenantId}/${mediaId}`;
  await storage.put(key, buffer, meta.mime_type);
  return key;
}
