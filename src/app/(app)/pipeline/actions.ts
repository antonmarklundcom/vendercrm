"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantOperator } from "@/modules/tenancy/context";
import { moveDeal, createDeal } from "@/modules/crm/deals";

const moveDealSchema = z.object({
  dealId: z.string().min(1),
  toStageId: z.string().min(1),
  toPosition: z.number().int().min(0),
});

export async function moveDealAction(input: {
  dealId: string;
  toStageId: string;
  toPosition: number;
}) {
  const ctx = await requireTenantOperator();
  const parsed = moveDealSchema.parse(input);
  await moveDeal(ctx, parsed.dealId, { toStageId: parsed.toStageId, toPosition: parsed.toPosition });
  revalidatePath("/pipeline");
}

const createDealSchema = z.object({
  contactId: z.string().min(1),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  title: z.string().min(1).max(200),
  value: z.coerce.number().int().min(0).optional(),
});

export async function createDealAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const input = createDealSchema.parse({
    contactId: formData.get("contactId"),
    pipelineId: formData.get("pipelineId"),
    stageId: formData.get("stageId"),
    title: formData.get("title"),
    value: formData.get("value") || undefined,
  });
  await createDeal(ctx, input);
  revalidatePath("/pipeline");
}
