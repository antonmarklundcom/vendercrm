import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversations, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueue } from "@/lib/queue";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getAccount, getDecryptedAccessToken } from "./accounts";
import { GRAPH_API_BASE } from "./graph";

// Outbound sends (PLAN.md §6.4). All outbound goes through this service —
// the 24h window / template enforcement lives here so callers (inbox UI,
// automations, quotes) can't bypass it.

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Meta's own limits on interactive messages. Exceeding any of them is a 400
// on the send, not a truncation, so they are enforced before the call.
const MAX_LIST_ROWS = 10;
const MAX_BUTTONS = 3;
const MAX_ROW_TITLE = 24;

export type SendTextInput = { conversationId: string; body: string };
export type SendTemplateInput = {
  conversationId: string;
  templateName: string;
  language: string;
  components?: unknown[];
};

/**
 * An interactive reply-button or list message (Cloud API `interactive`).
 *
 * The rows carry an `id` of our own choosing, which is what Meta echoes back
 * in the webhook when the customer taps — that id is how a tap becomes a
 * booking without asking them to type a time back at us.
 */
export type SendInteractiveInput = {
  conversationId: string;
  body: string;
  /** Shown above the list; ignored for buttons. */
  header?: string;
  footer?: string;
  /** The list's own button label, e.g. "Ver horarios". Lists only. */
  actionLabel?: string;
  rows: Array<{ id: string; title: string; description?: string }>;
};

export type SendDocumentInput = {
  conversationId: string;
  /** Publicly reachable HTTPS URL — Meta fetches the file itself. */
  link: string;
  filename: string;
  caption?: string;
};

export async function sendText(ctx: TenantContext, input: SendTextInput) {
  const conversation = await getConversationOrThrow(ctx, input.conversationId);

  if (!withinFreeFormWindow(conversation.lastInboundAt)) {
    throw new Error(
      "La ventana de 24 horas está cerrada — solo se pueden enviar plantillas aprobadas.",
    );
  }

  return queueOutboundMessage(ctx, conversation.id, {
    type: "text",
    body: input.body,
    graphPayload: { messaging_product: "whatsapp", type: "text", text: { body: input.body } },
  });
}

/** Templates are always allowed, inside or outside the window (§6.4). */
export async function sendTemplate(ctx: TenantContext, input: SendTemplateInput) {
  const conversation = await getConversationOrThrow(ctx, input.conversationId);

  return queueOutboundMessage(ctx, conversation.id, {
    type: "template",
    body: input.templateName,
    graphPayload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.language },
        components: input.components ?? [],
      },
    },
  });
}

/**
 * Documents are ordinary free-form messages as far as Meta is concerned, so
 * they need an open 24h window just like text (§6.4). Quote delivery (§8)
 * calls this; when the window is shut the caller falls back to the public
 * link rather than silently failing.
 */
export async function sendDocument(ctx: TenantContext, input: SendDocumentInput) {
  const conversation = await getConversationOrThrow(ctx, input.conversationId);

  if (!withinFreeFormWindow(conversation.lastInboundAt)) {
    throw new Error(
      "La ventana de 24 horas está cerrada — solo se pueden enviar plantillas aprobadas.",
    );
  }

  return queueOutboundMessage(ctx, conversation.id, {
    type: "document",
    body: input.caption ?? input.filename,
    graphPayload: {
      messaging_product: "whatsapp",
      type: "document",
      document: { link: input.link, filename: input.filename, caption: input.caption },
    },
  });
}

/**
 * Interactive messages are free-form as far as Meta is concerned, so they
 * need an open 24h window exactly like text. Worth stating because "it's a
 * template-shaped thing with buttons" is the natural wrong assumption: an
 * interactive message is *not* a template and cannot open a conversation.
 *
 * Meta caps a list at 10 rows and a title at 24 characters, and rejects the
 * whole send when either is exceeded — so both are enforced here rather than
 * left to a 400 the caller sees as "sending is broken".
 */
export async function sendInteractive(ctx: TenantContext, input: SendInteractiveInput) {
  const conversation = await getConversationOrThrow(ctx, input.conversationId);

  if (!withinFreeFormWindow(conversation.lastInboundAt)) {
    throw new Error(
      "La ventana de 24 horas está cerrada — solo se pueden enviar plantillas aprobadas.",
    );
  }
  if (input.rows.length === 0) throw new Error("No hay opciones para ofrecer.");

  const rows = input.rows.slice(0, MAX_LIST_ROWS).map((row) => ({
    id: row.id.slice(0, 200),
    title: row.title.slice(0, MAX_ROW_TITLE),
    ...(row.description ? { description: row.description.slice(0, 72) } : {}),
  }));

  // Three or fewer options read better as buttons — no extra tap to open a
  // list — and that is the common case for "here are the next slots".
  const useButtons = rows.length <= MAX_BUTTONS;
  const interactive = useButtons
    ? {
        type: "button",
        body: { text: input.body },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
        action: {
          buttons: rows.map((row) => ({
            type: "reply",
            reply: { id: row.id, title: row.title },
          })),
        },
      }
    : {
        type: "list",
        ...(input.header ? { header: { type: "text", text: input.header } } : {}),
        body: { text: input.body },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
        action: {
          button: (input.actionLabel ?? "Ver opciones").slice(0, 20),
          sections: [{ title: (input.header ?? "Opciones").slice(0, 24), rows }],
        },
      };

  return queueOutboundMessage(ctx, conversation.id, {
    type: "interactive",
    body: input.body,
    graphPayload: { messaging_product: "whatsapp", type: "interactive", interactive },
  });
}

function withinFreeFormWindow(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < WINDOW_MS;
}

async function getConversationOrThrow(ctx: TenantContext, conversationId: string) {
  const [conversation] = await tenantDb(ctx).select(
    conversations,
    eq(conversations.id, conversationId),
  );
  if (!conversation) throw new Error(`Conversation ${conversationId} not found`);
  return conversation;
}

async function queueOutboundMessage(
  ctx: TenantContext,
  conversationId: string,
  input: {
    type: "text" | "template" | "document" | "interactive";
    body: string;
    graphPayload: Record<string, unknown>;
  },
) {
  const messageId = newId();
  await tenantDb(ctx)
    .insert(messages)
    .values({
      id: messageId,
      conversationId,
      direction: "out",
      type: input.type,
      body: input.body,
      status: "queued",
    });

  // Sends are serialized per wa_account by nature of the single-process
  // worker's sequential job loop (§2.1) — good enough throughput
  // conservatism for Phase 1 without extra coordination.
  await enqueue(
    "whatsapp.send",
    { messageId, graphPayload: input.graphPayload },
    { tenantId: ctx.tenantId },
  );

  return messageId;
}

/** Job handler body (registered in ./jobs.ts) — the actual Graph API call. */
export async function deliverQueuedMessage(
  tenantId: string,
  messageId: string,
  graphPayload: Record<string, unknown>,
): Promise<void> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message) return;

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId));
  if (!conversation) return;

  // No TenantContext at this layer (job payloads carry raw ids, §3.3) — a
  // system context scoped to the job's own tenantId, same pattern as
  // webhook processing.
  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return;

  const account = await getAccount(ctx, conversation.waAccountId);
  if (!account) {
    await failMessage(messageId, "WhatsApp account not found");
    return;
  }

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, conversation.contactId));
  if (!contact) {
    await failMessage(messageId, "Contact not found");
    return;
  }

  const token = getDecryptedAccessToken(account);
  const payload = { ...graphPayload, to: contact.phone.replace(/^\+/, "") };

  const res = await fetch(`${GRAPH_API_BASE}/${account.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    await failMessage(messageId, errorBody.slice(0, 2000));
    throw new Error(`WhatsApp send failed: ${res.status} ${errorBody.slice(0, 200)}`);
  }

  const result = (await res.json()) as { messages?: Array<{ id: string }> };
  const waMessageId = result.messages?.[0]?.id;

  await db.update(messages).set({ status: "sent", waMessageId }).where(eq(messages.id, messageId));
}

async function failMessage(messageId: string, error: string) {
  await db
    .update(messages)
    .set({ status: "failed", error: { message: error } })
    .where(eq(messages.id, messageId));
}
