"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantContext } from "@/modules/tenancy/context";
import { assertWritable } from "@/modules/tenancy/access";
import {
  connectManual,
  sendMessage,
  assignConversation,
  markConversationRead,
  syncTemplates,
  getConversation,
} from "@/modules/whatsapp";
import { getDefaultPipeline, listStages } from "@/modules/crm/pipelines";
import { createDeal } from "@/modules/crm/deals";

async function writableCtx() {
  const ctx = await requireTenantContext();
  await assertWritable(ctx.tenantId);
  return ctx;
}

const connectSchema = z.object({
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  displayNumber: z.string().optional(),
});

export async function connectManualAction(formData: FormData) {
  const ctx = await writableCtx();
  const input = connectSchema.parse({
    wabaId: formData.get("wabaId"),
    phoneNumberId: formData.get("phoneNumberId"),
    accessToken: formData.get("accessToken"),
    displayNumber: formData.get("displayNumber") || undefined,
  });
  await connectManual(ctx, input);
  revalidatePath("/app/inbox");
}

export async function sendTextAction(conversationId: string, body: string) {
  const ctx = await writableCtx();
  const trimmed = body.trim();
  if (!trimmed) return;
  await sendMessage(ctx, { conversationId, kind: "text", body: trimmed });
  revalidatePath("/app/inbox");
}

export async function sendTemplateAction(
  conversationId: string,
  templateName: string,
  templateLanguage: string,
) {
  const ctx = await writableCtx();
  await sendMessage(ctx, {
    conversationId,
    kind: "template",
    templateName,
    templateLanguage,
  });
  revalidatePath("/app/inbox");
}

export async function assignToMeAction(conversationId: string) {
  const ctx = await writableCtx();
  await assignConversation(ctx, conversationId, ctx.userId);
  revalidatePath("/app/inbox");
}

export async function markReadAction(conversationId: string) {
  const ctx = await requireTenantContext();
  await markConversationRead(ctx, conversationId);
  revalidatePath("/app/inbox");
}

export async function syncTemplatesAction(waAccountId: string) {
  const ctx = await writableCtx();
  await syncTemplates(ctx, waAccountId);
  revalidatePath("/app/inbox");
}

export async function convertToDealAction(conversationId: string) {
  const ctx = await writableCtx();
  const conversation = await getConversation(ctx, conversationId);
  if (!conversation) return;
  const pipeline = await getDefaultPipeline(ctx);
  if (!pipeline) return;
  const stages = await listStages(ctx, pipeline.id);
  await createDeal(ctx, {
    contactId: conversation.contactId,
    pipelineId: pipeline.id,
    stageId: stages[0].id,
    title: "WhatsApp",
  });
  revalidatePath("/app/inbox");
}
