import { eq } from "drizzle-orm";
import { messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import { tenantContextFromJob } from "@/modules/tenancy/context";
import { upsertContactByPhoneOrEmail } from "@/modules/crm/contacts";
import { storage } from "@/lib/storage";
import { emit } from "@/lib/events";
import { getAccountByPhoneNumberId } from "./platform";
import {
  upsertConversation,
  recordInboundOnConversation,
} from "./conversations";
import { getAccountById } from "./accounts";
import { getMediaUrl, downloadMedia } from "./graph";

// Raised when a webhook references a phone_number_id we don't recognise. The
// caller marks the event failed and keeps the raw payload (PLAN.md §6.3 rule 4)
// — it never crashes the route.
export class UnknownAccountError extends Error {
  constructor(public phoneNumberId: string) {
    super(`Unknown phone_number_id: ${phoneNumberId}`);
    this.name = "UnknownAccountError";
  }
}

type MetaMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: {
    button_reply?: { title: string };
    list_reply?: { title: string };
  };
  image?: { id: string };
  document?: { id: string; filename?: string };
  audio?: { id: string };
  video?: { id: string };
};

const MEDIA_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);

function extractBody(m: MetaMessage): string | null {
  if (m.type === "text") return m.text?.body ?? null;
  if (m.type === "button") return m.button?.text ?? null;
  if (m.type === "interactive")
    return (
      m.interactive?.button_reply?.title ??
      m.interactive?.list_reply?.title ??
      null
    );
  return null;
}

function mediaIdOf(m: MetaMessage): string | null {
  return (
    m.image?.id ?? m.document?.id ?? m.audio?.id ?? m.video?.id ?? null
  );
}

// Has this Meta message id already been stored? The unique index on
// wa_message_id is the hard guard; this pre-check lets us skip the side effects
// (unread bump, media fetch, event emit) on redelivery (PLAN.md §6.3 rule 3).
// wa_message_id is globally unique, so a tenant-scoped check is sufficient.
async function alreadyStored(
  ctx: ReturnType<typeof tenantContextFromJob>,
  waMessageId: string,
): Promise<boolean> {
  const rows = await tenantDb(ctx).select(
    messages,
    eq(messages.waMessageId, waMessageId),
  );
  return rows.length > 0;
}

// Processes one webhook payload. Idempotent and durable: it runs inside a queue
// job, so a crash mid-way is retried, and duplicate Meta deliveries are no-ops.
export async function processWebhookPayload(payload: unknown): Promise<void> {
  const body = payload as {
    entry?: {
      changes?: {
        field?: string;
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: MetaMessage[];
          statuses?: {
            id: string;
            status: string;
            errors?: unknown;
          }[];
        };
      }[];
    }[];
  };

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const account = await getAccountByPhoneNumberId(phoneNumberId);
      if (!account) throw new UnknownAccountError(phoneNumberId);

      const ctx = tenantContextFromJob({ tenantId: account.tenantId });
      const profileName =
        value?.contacts?.[0]?.profile?.name ?? undefined;

      for (const m of value?.messages ?? []) {
        await handleInboundMessage(ctx, account.id, m, profileName);
      }
      for (const s of value?.statuses ?? []) {
        await handleStatus(ctx, s);
      }
    }
  }
}

async function handleInboundMessage(
  ctx: ReturnType<typeof tenantContextFromJob>,
  waAccountId: string,
  m: MetaMessage,
  profileName?: string,
) {
  if (await alreadyStored(ctx, m.id)) return; // redelivery — no-op

  const phone = `+${m.from.replace(/[^\d]/g, "")}`;
  const { contactId } = await upsertContactByPhoneOrEmail(ctx, {
    name: profileName || phone,
    phone,
    source: "whatsapp",
  });
  const conversationId = await upsertConversation(ctx, {
    waAccountId,
    contactId,
  });

  const body = extractBody(m);
  const mediaId = MEDIA_TYPES.has(m.type) ? mediaIdOf(m) : null;
  const messageId = newId();

  try {
    await tenantDb(ctx).insert(messages, {
      id: messageId,
      conversationId,
      direction: "in",
      waMessageId: m.id,
      type: m.type,
      body,
      mediaId,
      status: "delivered",
    });
  } catch (err) {
    // Lost the race to a concurrent redelivery — the unique index rejected it.
    if (isDuplicateKey(err)) return;
    throw err;
  }

  const at = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
  await recordInboundOnConversation(ctx, conversationId, at);

  // Media URLs expire fast — fetch immediately and persist (PLAN.md §6.3).
  if (mediaId) {
    await persistMedia(ctx, waAccountId, messageId, mediaId).catch((e) =>
      console.error("[whatsapp] media persist failed", e),
    );
  }

  await emit("wa.message_received", {
    tenantId: ctx.tenantId,
    waAccountId,
    conversationId,
    contactId,
    messageId,
    text: body,
  });
}

async function persistMedia(
  ctx: ReturnType<typeof tenantContextFromJob>,
  waAccountId: string,
  messageId: string,
  mediaId: string,
) {
  const account = await getAccountById(ctx, waAccountId);
  if (!account) return;
  const url = await getMediaUrl(account, mediaId);
  if (!url) return;
  const bytes = await downloadMedia(account, url);
  if (!bytes) return;
  const key = `${ctx.tenantId}/whatsapp/${messageId}`;
  await storage.put(key, bytes);
  await tenantDb(ctx).update(
    messages,
    { storageKey: key },
    eq(messages.id, messageId),
  );
}

async function handleStatus(
  ctx: ReturnType<typeof tenantContextFromJob>,
  status: { id: string; status: string; errors?: unknown },
) {
  const mapped =
    status.status === "sent" ||
    status.status === "delivered" ||
    status.status === "read" ||
    status.status === "failed"
      ? status.status
      : null;
  if (!mapped) return;
  await tenantDb(ctx).update(
    messages,
    { status: mapped, error: status.errors ? (status.errors as object) : null },
    eq(messages.waMessageId, status.id),
  );
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ER_DUP_ENTRY"
  );
}
