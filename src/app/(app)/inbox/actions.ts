"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantOperator } from "@/modules/tenancy/context";
import { sendText, sendTemplate } from "@/modules/whatsapp/send";
import { markConversationRead } from "@/modules/whatsapp/inbox";

const sendTextSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().min(1).max(4096),
});

export async function sendTextAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const input = sendTextSchema.parse({
    conversationId: formData.get("conversationId"),
    body: formData.get("body"),
  });

  await sendText(ctx, input);
  revalidatePath(`/inbox/${input.conversationId}`);
}

// The picker submits "name|language" as one value — the pair is the
// template's identity (§6.4 sends require both), and keeping them in one
// option value avoids a second dependent <select>.
const sendTemplateSchema = z.object({
  conversationId: z.string().min(1),
  template: z.string().min(1).includes("|"),
});

export async function sendTemplateAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const input = sendTemplateSchema.parse({
    conversationId: formData.get("conversationId"),
    template: formData.get("template"),
  });

  const separator = input.template.lastIndexOf("|");
  await sendTemplate(ctx, {
    conversationId: input.conversationId,
    templateName: input.template.slice(0, separator),
    language: input.template.slice(separator + 1),
  });
  revalidatePath(`/inbox/${input.conversationId}`);
}

export async function markReadAction(conversationId: string) {
  const ctx = await requireTenantOperator();
  await markConversationRead(ctx, conversationId);
  revalidatePath("/inbox");
}
