import { eq } from "drizzle-orm";
import { deals } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { filterBySiteScope, siteInScope } from "@/modules/access/scope";
import { getStage } from "./pipelines";
import { createActivity } from "./activities";
import { crmEvents } from "./events";

// Deals / kanban (PLAN.md §4, §5): stage change writes an `activities` row
// and emits `deal.stage_changed` (automation trigger, §7.1).

export type CreateDealInput = {
  contactId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  value?: number;
  currency?: string;
  assignedUserId?: string;
  position?: number;
  /** Set by lead ingest so the pipeline can be filtered per site (§5.2). */
  siteId?: string;
};

export async function createDeal(ctx: TenantContext, input: CreateDealInput) {
  const id = newId();
  await tenantDb(ctx)
    .insert(deals)
    .values({
      id,
      contactId: input.contactId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      title: input.title,
      value: input.value ?? 0,
      currency: input.currency ?? "PYG",
      assignedUserId: input.assignedUserId,
      position: input.position ?? 0,
      siteId: input.siteId,
    });
  return getDeal(ctx, id);
}

export async function getDeal(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(deals, eq(deals.id, id));
  if (!row) return null;
  if (!siteInScope(ctx, row.siteId)) return null;
  return row;
}

export async function listDealsForPipeline(ctx: TenantContext, pipelineId: string) {
  const rows = await tenantDb(ctx).select(deals, eq(deals.pipelineId, pipelineId));
  return filterBySiteScope(ctx, rows, (row) => row.siteId).sort((a, b) => a.position - b.position);
}

export async function listDealsForContact(ctx: TenantContext, contactId: string) {
  const rows = await tenantDb(ctx).select(deals, eq(deals.contactId, contactId));
  return filterBySiteScope(ctx, rows, (row) => row.siteId).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export type UpdateDealInput = Partial<
  Pick<CreateDealInput, "title" | "value" | "currency" | "assignedUserId">
>;

export async function updateDeal(ctx: TenantContext, id: string, input: UpdateDealInput) {
  await tenantDb(ctx).update(deals).set(input).where(eq(deals.id, id));
  return getDeal(ctx, id);
}

export async function assignDeal(ctx: TenantContext, id: string, assignedUserId: string) {
  return updateDeal(ctx, id, { assignedUserId });
}

/**
 * Drag-and-drop kanban move (§5): moving a deal to a different stage writes
 * an `activities` row and emits `deal.stage_changed`; moving within the same
 * stage (reorder) just updates `position`, no activity/event noise.
 */
export async function moveDeal(
  ctx: TenantContext,
  dealId: string,
  input: { toStageId: string; toPosition: number },
) {
  const deal = await getDeal(ctx, dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const changingStage = deal.stageId !== input.toStageId;

  if (!changingStage) {
    await tenantDb(ctx)
      .update(deals)
      .set({ position: input.toPosition })
      .where(eq(deals.id, dealId));
    return getDeal(ctx, dealId);
  }

  const toStage = await getStage(ctx, input.toStageId);
  if (!toStage) throw new Error(`Stage ${input.toStageId} not found`);

  const now = new Date();
  await tenantDb(ctx)
    .update(deals)
    .set({
      stageId: input.toStageId,
      position: input.toPosition,
      stageEnteredAt: now,
      closedAt: toStage.isWon || toStage.isLost ? now : null,
    })
    .where(eq(deals.id, dealId));

  await createActivity(ctx, {
    contactId: deal.contactId,
    dealId: deal.id,
    type: "stage_change",
    payload: { fromStageId: deal.stageId, toStageId: input.toStageId },
  });

  await crmEvents.emit("deal.stage_changed", {
    tenantId: ctx.tenantId,
    dealId: deal.id,
    fromStageId: deal.stageId,
    toStageId: input.toStageId,
  });

  return getDeal(ctx, dealId);
}

export async function deleteDeal(ctx: TenantContext, id: string) {
  await tenantDb(ctx).delete(deals, eq(deals.id, id));
}
