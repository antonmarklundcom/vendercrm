import { eq } from "drizzle-orm";
import { deals, pipelines, stages } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Pipelines/stages config (PLAN.md §4, §5). Multiple pipelines per tenant;
// a default pipeline is seeded at tenant creation (called from the
// superadmin tenant-creation action, not from modules/tenancy — crm stays
// downstream of tenancy, not the other way around).

const DEFAULT_STAGES: Array<{
  name: string;
  color: string;
  isWon?: boolean;
  isLost?: boolean;
}> = [
  { name: "Nuevo contacto", color: "#64748b" },
  { name: "Contactado", color: "#3b82f6" },
  { name: "Propuesta enviada", color: "#f59e0b" },
  { name: "Negociación", color: "#a855f7" },
  { name: "Ganado", color: "#22c55e", isWon: true },
  { name: "Perdido", color: "#ef4444", isLost: true },
];

export async function seedDefaultPipeline(ctx: TenantContext) {
  return createPipelineWithDefaultStages(ctx, "Ventas");
}

// A tenant running several sales motions (§10 1R #1 — dental leads, property
// valuations, well drilling) needs more than the one pipeline seeded at
// tenant creation. New pipelines start with the same default stage set so
// the board isn't empty; stages can be edited afterward like any other.
export async function createPipelineWithDefaultStages(ctx: TenantContext, name: string) {
  const pipelineId = newId();
  const existing = await listPipelines(ctx);
  await tenantDb(ctx)
    .insert(pipelines)
    .values({ id: pipelineId, name, position: existing.length });

  for (const [index, stage] of DEFAULT_STAGES.entries()) {
    await tenantDb(ctx)
      .insert(stages)
      .values({
        id: newId(),
        pipelineId,
        name: stage.name,
        position: index,
        color: stage.color,
        isWon: stage.isWon ?? false,
        isLost: stage.isLost ?? false,
      });
  }

  return getPipeline(ctx, pipelineId);
}

export type CreatePipelineInput = { name: string; position?: number };

export async function createPipeline(ctx: TenantContext, input: CreatePipelineInput) {
  const id = newId();
  await tenantDb(ctx)
    .insert(pipelines)
    .values({ id, name: input.name, position: input.position ?? 0 });
  return getPipeline(ctx, id);
}

export async function getPipeline(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(pipelines, eq(pipelines.id, id));
  return row ?? null;
}

export function listPipelines(ctx: TenantContext) {
  return tenantDb(ctx)
    .select(pipelines)
    .then((rows) => rows.sort((a, b) => a.position - b.position));
}

export type CreateStageInput = {
  pipelineId: string;
  name: string;
  position?: number;
  color?: string;
  isWon?: boolean;
  isLost?: boolean;
};

export async function createStage(ctx: TenantContext, input: CreateStageInput) {
  const id = newId();
  await tenantDb(ctx)
    .insert(stages)
    .values({
      id,
      pipelineId: input.pipelineId,
      name: input.name,
      position: input.position ?? 0,
      color: input.color,
      isWon: input.isWon ?? false,
      isLost: input.isLost ?? false,
    });
  const [row] = await tenantDb(ctx).select(stages, eq(stages.id, id));
  return row ?? null;
}

export async function listStagesForPipeline(ctx: TenantContext, pipelineId: string) {
  const rows = await tenantDb(ctx).select(stages, eq(stages.pipelineId, pipelineId));
  return rows.sort((a, b) => a.position - b.position);
}

export async function getStage(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(stages, eq(stages.id, id));
  return row ?? null;
}


// --- Stage configuration (PLAN.md §13 H8) -------------------------------
//
// Renaming, reordering, recolouring and marking won/lost. Deleting is
// allowed only for an empty stage: a stage with deals in it can't be removed
// without silently moving or destroying them, and neither is a decision this
// UI should make on the tenant's behalf.

export class StageConfigError extends Error {
  constructor(readonly code: "notEmpty" | "notFound" | "lastStage") {
    super(code);
  }
}

export type UpdateStageInput = {
  name?: string;
  color?: string | null;
  isWon?: boolean;
  isLost?: boolean;
  /** Days a deal can sit in this stage before the board flags it stale
   *  (PLAN.md §15.8 P5). Null/undefined = never flag. */
  staleAfterDays?: number | null;
};

export async function updateStage(ctx: TenantContext, id: string, input: UpdateStageInput) {
  const stage = await getStage(ctx, id);
  if (!stage) throw new StageConfigError("notFound");

  // Won and lost are mutually exclusive: a stage that claims both would make
  // "closed how?" unanswerable everywhere downstream.
  const values: UpdateStageInput = { ...input };
  if (input.isWon) values.isLost = false;
  if (input.isLost) values.isWon = false;

  await tenantDb(ctx).update(stages).set(values).where(eq(stages.id, id));
  return getStage(ctx, id);
}

/** Moves a stage one position left or right, swapping with its neighbour. */
export async function moveStage(ctx: TenantContext, id: string, direction: "left" | "right") {
  const stage = await getStage(ctx, id);
  if (!stage) throw new StageConfigError("notFound");

  const siblings = await listStagesForPipeline(ctx, stage.pipelineId);
  const index = siblings.findIndex((row) => row.id === id);
  const swapWith = direction === "left" ? siblings[index - 1] : siblings[index + 1];
  if (!swapWith) return stage;

  await tenantDb(ctx).update(stages).set({ position: swapWith.position }).where(eq(stages.id, id));
  await tenantDb(ctx)
    .update(stages)
    .set({ position: stage.position })
    .where(eq(stages.id, swapWith.id));

  return getStage(ctx, id);
}

export async function deleteStageIfEmpty(ctx: TenantContext, id: string) {
  const stage = await getStage(ctx, id);
  if (!stage) throw new StageConfigError("notFound");

  const siblings = await listStagesForPipeline(ctx, stage.pipelineId);
  if (siblings.length <= 1) throw new StageConfigError("lastStage");

  const held = await tenantDb(ctx).select(deals, eq(deals.stageId, id));
  if (held.length > 0) throw new StageConfigError("notEmpty");

  await tenantDb(ctx).delete(stages, eq(stages.id, id));
}
