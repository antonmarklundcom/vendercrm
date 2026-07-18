"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenantContext } from "@/modules/tenancy/context";
import { conversations, messages } from "@/db/schema/whatsapp";
import { contacts } from "@/db/schema/crm";
import { enqueue } from "@/lib/queue/enqueue";
import type { OutboundMessagePayload } from "./graph-api";
import { isWithin24HourWindow } from "./queries";

export type SendInput =
  | { type: "text"; body: string }
  | { type: "template"; templateName: string; language: string; components?: unknown[] };

export async function sendMessage(conversationId: string, input: SendInput): Promise<void> {
  const ctx = await getTenantContext();
  const scoped = tenantDb(ctx);

  const conversation = await scoped.findFirst(conversations, eq(conversations.id, conversationId));
  if (!conversation) throw new Error("Conversation not found");

  const contact = await scoped.findFirst(contacts, eq(contacts.id, conversation.contactId));
  if (!contact) throw new Error("Contact not found");

  if (input.type === "text" && !isWithin24HourWindow(conversation.lastInboundAt)) {
    throw new Error(
      "La ventana de 24 horas está cerrada — usá una plantilla para volver a escribirle a este contacto.",
    );
  }

  const graphPayload: OutboundMessagePayload =
    input.type === "text"
      ? { type: "text", text: { body: input.body } }
      : {
          type: "template",
          template: {
            name: input.templateName,
            language: { code: input.language },
            components: input.components,
          },
        };

  const [inserted] = await scoped
    .insert(messages, {
      conversationId,
      direction: "out",
      type: input.type === "text" ? "text" : "template",
      body: input.type === "text" ? input.body : null,
      templateName: input.type === "template" ? input.templateName : null,
      status: "queued",
      sentByUserId: ctx.userId,
    })
    .$returningId();

  await scoped.update(
    conversations,
    { lastMessageAt: new Date() },
    eq(conversations.id, conversationId),
  );

  await enqueue("whatsapp.send_message", {
    tenantId: ctx.tenantId,
    messageId: inserted.id,
    waAccountId: conversation.waAccountId,
    // Meta expects digits only (country code + number), no leading '+'.
    to: contact.phone.replace(/^\+/, ""),
    payload: graphPayload,
  });

  revalidatePath(`/inbox/${conversationId}`);
}
