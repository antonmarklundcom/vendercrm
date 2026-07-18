"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenantContext } from "@/modules/tenancy/context";
import { activities, deals, pipelines, stages } from "@/db/schema/crm";
import { crmEvents } from "./events";
import { DEFAULT_STAGES } from "./pipeline-defaults";

export async function createDeal(input: {
  contactId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  value?: number;
}): Promise<void> {
  const ctx = await getTenantContext();

  await tenantDb(ctx).insert(deals, {
    contactId: input.contactId,
    pipelineId: input.pipelineId,
    stageId: input.stageId,
    title: input.title,
    value: input.value ?? null,
  });

  revalidatePath("/pipeline");
}

export async function moveDeal(dealId: string, toStageId: string): Promise<void> {
  const ctx = await getTenantContext();
  const scoped = tenantDb(ctx);

  const deal = await scoped.findFirst(deals, eq(deals.id, dealId));
  if (!deal) throw new Error("Deal not found");
  if (deal.stageId === toStageId) return;

  const fromStageId = deal.stageId;

  await scoped.update(
    deals,
    { stageId: toStageId, stageEnteredAt: new Date() },
    eq(deals.id, dealId),
  );

  await scoped.insert(activities, {
    contactId: deal.contactId,
    dealId: deal.id,
    type: "stage_change",
    userId: ctx.userId,
    payload: { fromStageId, toStageId },
  });

  await crmEvents.emit("deal.stage_changed", {
    tenantId: ctx.tenantId,
    dealId: deal.id,
    contactId: deal.contactId,
    fromStageId,
    toStageId,
  });

  revalidatePath("/pipeline");
  revalidatePath(`/contacts/${deal.contactId}`);
}

export async function createPipeline(name: string): Promise<void> {
  const ctx = await getTenantContext();
  const scoped = tenantDb(ctx);

  const existing = await scoped.findMany(pipelines);

  const [inserted] = await scoped
    .insert(pipelines, { name, position: existing.length })
    .$returningId();

  for (const stage of DEFAULT_STAGES) {
    await scoped.insert(stages, { ...stage, pipelineId: inserted.id });
  }

  revalidatePath("/pipeline");
}
