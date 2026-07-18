"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenantContext } from "@/modules/tenancy/context";
import { conversations } from "@/db/schema/whatsapp";
import { deals } from "@/db/schema/crm";
import { getDefaultPipeline, getStagesForPipeline } from "@/modules/crm/pipeline-queries";

export async function assignConversation(
  conversationId: string,
  userId: string | null,
): Promise<void> {
  const ctx = await getTenantContext();

  await tenantDb(ctx).update(
    conversations,
    { assignedUserId: userId },
    eq(conversations.id, conversationId),
  );

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

export async function convertConversationToDeal(conversationId: string): Promise<void> {
  const ctx = await getTenantContext();
  const scoped = tenantDb(ctx);

  const conversation = await scoped.findFirst(conversations, eq(conversations.id, conversationId));
  if (!conversation) throw new Error("Conversation not found");

  const pipeline = await getDefaultPipeline(ctx);
  if (!pipeline) throw new Error("No pipeline configured");

  const stages = await getStagesForPipeline(ctx, pipeline.id);
  const firstStage = stages[0];
  if (!firstStage) throw new Error("Pipeline has no stages");

  await scoped.insert(deals, {
    contactId: conversation.contactId,
    pipelineId: pipeline.id,
    stageId: firstStage.id,
    title: "Negocio desde WhatsApp",
  });

  redirect("/pipeline");
}
