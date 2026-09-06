import { eq } from "drizzle-orm";
import { deals } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getStage, listStagesForPipeline } from "./pipelines";
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
    });
  return getDeal(ctx, id);
}

export async function getDeal(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(deals, eq(deals.id, id));
  return row ?? null;
}

export async function listDealsForPipeline(ctx: TenantContext, pipelineId: string) {
  const rows = await tenantDb(ctx).select(deals, eq(deals.pipelineId, pipelineId));
  return rows.sort((a, b) => a.position - b.position);
}

/** Value total per stage (PLAN.md §15.8 P5's board column totals) — a pure
 *  grouping over rows the caller already has, so the board and any test of
 *  it agree on the same arithmetic. Assumes one currency per stage, the
 *  same assumption `formatMoney` on the board makes. */
export function totalsByStage(
  rows: Array<Pick<typeof deals.$inferSelect, "stageId" | "value">>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.stageId, (totals.get(row.stageId) ?? 0) + row.value);
  }
  return totals;
}

export async function listDealsForContact(ctx: TenantContext, contactId: string) {
  const rows = await tenantDb(ctx).select(deals, eq(deals.contactId, contactId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type UpdateDealInput = Partial<
  Pick<CreateDealInput, "title" | "value" | "currency" | "assignedUserId">
> & {
  /** Pipeline forecasting (§15.8 P5); null clears it. */
  expectedCloseAt?: Date | null;
};

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


// --- Closing a deal (PLAN.md §13 H8) -----------------------------------
//
// Won and lost are stages, not a separate status column (the `is_won` /
// `is_lost` flags have been on `stages` since §4). Closing is therefore the
// same move the board already does, with a reason attached — which keeps one
// code path, one activity row, and one `deal.stage_changed` event for the
// automations that listen for it.

export class DealCloseError extends Error {
  constructor(readonly code: "noStage" | "notFound") {
    super(code);
  }
}

/** The stage this pipeline uses for won (or lost) deals, if it has one. */
export async function findOutcomeStage(
  ctx: TenantContext,
  pipelineId: string,
  outcome: "won" | "lost",
) {
  const all = await listStagesForPipeline(ctx, pipelineId);
  return all.find((stage) => (outcome === "won" ? stage.isWon : stage.isLost)) ?? null;
}

export async function closeDeal(
  ctx: TenantContext,
  dealId: string,
  outcome: "won" | "lost",
  reason?: string,
) {
  const deal = await getDeal(ctx, dealId);
  if (!deal) throw new DealCloseError("notFound");

  const stage = await findOutcomeStage(ctx, deal.pipelineId, outcome);
  // A pipeline with no won/lost stage can't close a deal, and inventing one
  // silently would be worse than saying so: the config UI is where that gets
  // fixed.
  if (!stage) throw new DealCloseError("noStage");

  const siblings = await tenantDb(ctx).select(deals, eq(deals.stageId, stage.id));
  await moveDeal(ctx, dealId, { toStageId: stage.id, toPosition: siblings.length });
  // Won and lost answer different questions (§15.8 P5's schema comment): a
  // won deal keeps `closeReason` ("what happened"); a lost one writes
  // `lostReason` ("why we lost") and leaves `closeReason` alone.
  await tenantDb(ctx)
    .update(deals)
    .set(
      outcome === "lost"
        ? { lostReason: reason?.slice(0, 500) ?? null }
        : { closeReason: reason?.slice(0, 500) ?? null },
    )
    .where(eq(deals.id, dealId));

  return getDeal(ctx, dealId);
}

/** Puts a closed deal back on the board, in the stage the caller names. */
export async function reopenDeal(ctx: TenantContext, dealId: string, toStageId: string) {
  const siblings = await tenantDb(ctx).select(deals, eq(deals.stageId, toStageId));
  await moveDeal(ctx, dealId, { toStageId, toPosition: siblings.length });
  await tenantDb(ctx)
    .update(deals)
    .set({ closeReason: null, lostReason: null })
    .where(eq(deals.id, dealId));
  return getDeal(ctx, dealId);
}
