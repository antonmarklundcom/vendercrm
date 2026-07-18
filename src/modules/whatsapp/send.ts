import { eq } from "drizzle-orm";
import { messages, conversations, contacts, waAccounts, waTemplates } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import { tenantContextFromJob } from "@/modules/tenancy/context";
import type { TenantContext } from "@/modules/tenancy/types";
import { enqueue } from "@/lib/queue";
import { storage } from "@/lib/storage";
import { isWithinFreeformWindow, touchConversationOutbound } from "./conversations";
import {
  sendText,
  sendTemplate,
  sendDocument,
  uploadMedia,
  fetchTemplates,
  GraphError,
} from "./graph";

// Opaque follow-up job to enqueue once a send is confirmed delivered — lets
// other modules (e.g. quotes) react to delivery without whatsapp/send.ts
// importing them and creating a module cycle (PLAN.md §8).
export type OnDelivered = { jobType: string; payload: unknown };

export const WHATSAPP_SEND = "whatsapp.send";

export class WindowClosedError extends Error {
  constructor() {
    super(
      "Fuera de la ventana de 24h: solo se pueden enviar plantillas aprobadas",
    );
    this.name = "WindowClosedError";
  }
}

// All outbound goes through here (inbox, automations, quote sending). Enforces
// the 24-hour window centrally — callers don't (PLAN.md §6.4). Creates the
// message row as `queued` and enqueues delivery; the queue gives durable retry
// and (single worker) serialized sends per number.
export async function sendMessage(
  ctx: TenantContext,
  input:
    | { conversationId: string; kind: "text"; body: string; sentByUserId?: string }
    | {
        conversationId: string;
        kind: "template";
        templateName: string;
        templateLanguage: string;
        components?: unknown[];
        sentByUserId?: string;
      }
    | {
        conversationId: string;
        kind: "document";
        storageKey: string;
        filename: string;
        caption?: string;
        sentByUserId?: string;
        onDelivered?: OnDelivered;
      },
): Promise<string> {
  const tdb = tenantDb(ctx);
  const [conversation] = await tdb.select(
    conversations,
    eq(conversations.id, input.conversationId),
  );
  if (!conversation) throw new Error("Conversación no encontrada");

  // Free-form messages (text or document) are only allowed inside the 24h
  // window; outside it, only approved templates go out (PLAN.md §6.4).
  if (input.kind !== "template" && !isWithinFreeformWindow(conversation)) {
    throw new WindowClosedError();
  }

  const messageId = newId();
  await tdb.insert(messages, {
    id: messageId,
    conversationId: input.conversationId,
    direction: "out",
    type: input.kind,
    body:
      input.kind === "text"
        ? input.body
        : input.kind === "template"
          ? `[plantilla: ${input.templateName}]`
          : `[documento: ${input.filename}]`,
    status: "queued",
    sentByUserId: input.sentByUserId ?? ctx.userId ?? null,
  });

  await enqueue(
    WHATSAPP_SEND,
    {
      messageId,
      ...(input.kind === "text"
        ? { kind: "text", body: input.body }
        : input.kind === "template"
          ? {
              kind: "template",
              templateName: input.templateName,
              templateLanguage: input.templateLanguage,
              components: input.components,
            }
          : {
              kind: "document",
              storageKey: input.storageKey,
              filename: input.filename,
              caption: input.caption,
              onDelivered: input.onDelivered,
            }),
    },
    { tenantId: ctx.tenantId },
  );

  return messageId;
}

// Delivery worker: loads the queued message, calls Graph, records the result.
// Throws on retryable Graph errors so the queue retries with backoff; marks
// permanently failed on 4xx.
export async function deliverSendJob(
  payload: unknown,
  tenantId: string | null,
): Promise<void> {
  if (!tenantId) throw new Error("send job missing tenantId");
  const p = payload as
    | { messageId: string; kind: "text"; body: string }
    | {
        messageId: string;
        kind: "template";
        templateName: string;
        templateLanguage: string;
        components?: unknown[];
      }
    | {
        messageId: string;
        kind: "document";
        storageKey: string;
        filename: string;
        caption?: string;
        onDelivered?: OnDelivered;
      };

  const ctx = tenantContextFromJob({ tenantId });
  const tdb = tenantDb(ctx);

  const [message] = await tdb.select(messages, eq(messages.id, p.messageId));
  if (!message) return;
  if (message.status !== "queued") return; // already delivered/failed

  const [conversation] = await tdb.select(
    conversations,
    eq(conversations.id, message.conversationId),
  );
  if (!conversation) return;
  const [account] = await tdb.select(
    waAccounts,
    eq(waAccounts.id, conversation.waAccountId),
  );
  const [contact] = await tdb.select(
    contacts,
    eq(contacts.id, conversation.contactId),
  );
  if (!account || !contact?.phone) {
    await tdb.update(
      messages,
      { status: "failed", error: { reason: "missing account or phone" } },
      eq(messages.id, p.messageId),
    );
    return;
  }

  const to = contact.phone.replace(/[^\d]/g, "");

  try {
    const result =
      p.kind === "text"
        ? await sendText(account, to, p.body)
        : p.kind === "template"
          ? await sendTemplate(account, to, {
              name: p.templateName,
              language: p.templateLanguage,
              components: p.components,
            })
          : await (async () => {
              const bytes = await storage.get(p.storageKey);
              const mediaId = await uploadMedia(
                account,
                bytes,
                p.filename,
                "application/pdf",
              );
              return sendDocument(account, to, {
                mediaId,
                filename: p.filename,
                caption: p.caption,
              });
            })();

    await tdb.update(
      messages,
      { status: "sent", waMessageId: result.messageId ?? null },
      eq(messages.id, p.messageId),
    );
    await touchConversationOutbound(ctx, message.conversationId, new Date());

    if (p.kind === "document" && p.onDelivered) {
      await enqueue(p.onDelivered.jobType, p.onDelivered.payload, {
        tenantId,
      });
    }
  } catch (err) {
    if (err instanceof GraphError && err.retryable) {
      throw err; // queue retries with backoff
    }
    await tdb.update(
      messages,
      {
        status: "failed",
        error: {
          message: err instanceof Error ? err.message : String(err),
        },
      },
      eq(messages.id, p.messageId),
    );
  }
}

// --- Template sync -----------------------------------------------------------

export async function syncTemplates(
  ctx: TenantContext,
  waAccountId: string,
): Promise<number> {
  const tdb = tenantDb(ctx);
  const [account] = await tdb.select(waAccounts, eq(waAccounts.id, waAccountId));
  if (!account) throw new Error("Cuenta de WhatsApp no encontrada");

  const remote = await fetchTemplates(account);
  for (const t of remote) {
    const existing = await tdb.select(
      waTemplates,
      eq(waTemplates.name, t.name),
    );
    const match = existing.find(
      (e) => e.name === t.name && e.language === t.language,
    );
    if (match) {
      await tdb.update(
        waTemplates,
        {
          category: t.category,
          status: t.status,
          components: (t.components as object) ?? null,
        },
        eq(waTemplates.id, match.id),
      );
    } else {
      await tdb.insert(waTemplates, {
        id: newId(),
        waAccountId,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: (t.components as object) ?? null,
      });
    }
  }
  return remote.length;
}

export async function listApprovedTemplates(
  ctx: TenantContext,
  waAccountId: string,
) {
  const rows = await tenantDb(ctx).select(
    waTemplates,
    eq(waTemplates.waAccountId, waAccountId),
  );
  return rows.filter((t) => t.status === "APPROVED");
}
