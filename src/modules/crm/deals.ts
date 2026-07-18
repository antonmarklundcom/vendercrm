import { and, asc, eq } from "drizzle-orm";
import { deals, stages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";
import { emit } from "@/lib/events";
import { addActivity } from "./activities";

export async function createDeal(
  ctx: TenantContext,
  input: {
    contactId: string;
    pipelineId: string;
    stageId: string;
    title: string;
    value?: number | null;
    currency?: string;
    assignedUserId?: string | null;
  },
): Promise<string> {
  const id = newId();
  await tenantDb(ctx).insert(deals, {
    id,
    contactId: input.contactId,
    pipelineId: input.pipelineId,
    stageId: input.stageId,
    title: input.title,
    value: input.value ?? null,
    currency: input.currency ?? "PYG",
    assignedUserId: input.assignedUserId ?? null,
  });
  return id;
}

export async function getDeal(ctx: TenantContext, dealId: string) {
  const [row] = await tenantDb(ctx).select(deals, eq(deals.id, dealId));
  return row ?? null;
}

export async function listDealsByPipeline(
  ctx: TenantContext,
  pipelineId: string,
) {
  return tenantDb(ctx)
    .select(deals, eq(deals.pipelineId, pipelineId))
    .orderBy(asc(deals.position));
}

// Move a deal to a stage: writes a `stage_change` activity and emits
// `deal.stage_changed` (an automation trigger, PLAN.md §5). Closing stages
// (won/lost) stamp `closed_at`. No-op if already in the target stage.
export async function moveDeal(
  ctx: TenantContext,
  dealId: string,
  toStageId: string,
  position?: number,
): Promise<void> {
  const tdb = tenantDb(ctx);
  const [deal] = await tdb.select(deals, eq(deals.id, dealId));
  if (!deal) throw new Error("Oportunidad no encontrada");
  if (deal.stageId === toStageId && position === undefined) return;

  const [toStage] = await tdb.select(stages, eq(stages.id, toStageId));
  if (!toStage) throw new Error("Etapa no encontrada");

  const fromStageId = deal.stageId;
  const closing = toStage.isWon || toStage.isLost;

  await tdb.update(
    deals,
    {
      stageId: toStageId,
      position: position ?? deal.position,
      stageEnteredAt: new Date(),
      closedAt: closing ? new Date() : null,
    },
    eq(deals.id, dealId),
  );

  if (fromStageId !== toStageId) {
    await addActivity(ctx, {
      contactId: deal.contactId,
      dealId: deal.id,
      type: "stage_change",
      payload: { fromStageId, toStageId, stageName: toStage.name },
    });
    await emit("deal.stage_changed", {
      tenantId: ctx.tenantId,
      dealId: deal.id,
      contactId: deal.contactId,
      fromStageId,
      toStageId,
      userId: ctx.userId ?? null,
    });
  }
}

export async function assignDeal(
  ctx: TenantContext,
  dealId: string,
  assignedUserId: string | null,
): Promise<void> {
  await tenantDb(ctx).update(
    deals,
    { assignedUserId },
    eq(deals.id, dealId),
  );
}

export async function updateDeal(
  ctx: TenantContext,
  dealId: string,
  input: { title?: string; value?: number | null; currency?: string },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.value !== undefined) set.value = input.value;
  if (input.currency !== undefined) set.currency = input.currency;
  if (Object.keys(set).length === 0) return;
  await tenantDb(ctx).update(deals, set, eq(deals.id, dealId));
}

export async function listDealsForContact(
  ctx: TenantContext,
  contactId: string,
) {
  return tenantDb(ctx).select(
    deals,
    and(eq(deals.contactId, contactId))!,
  );
}
