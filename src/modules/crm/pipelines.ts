import { asc, eq } from "drizzle-orm";
import { pipelines, stages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import { tenantContextFromJob } from "@/modules/tenancy/context";
import type { TenantContext } from "@/modules/tenancy/types";

// Default pipeline seeded at tenant creation (PLAN.md §5). Spanish stage names;
// the last two mark won/lost so kanban and automations can reason about
// outcomes.
const DEFAULT_STAGES: {
  name: string;
  color: string;
  isWon?: boolean;
  isLost?: boolean;
}[] = [
  { name: "Nuevo", color: "#64748b" },
  { name: "Contactado", color: "#0ea5e9" },
  { name: "Propuesta", color: "#f59e0b" },
  { name: "Ganado", color: "#22c55e", isWon: true },
  { name: "Perdido", color: "#ef4444", isLost: true },
];

export async function seedDefaultPipeline(tenantId: string): Promise<string> {
  const ctx = tenantContextFromJob({ tenantId });
  const tdb = tenantDb(ctx);
  const pipelineId = newId();
  await tdb.insert(pipelines, {
    id: pipelineId,
    name: "Ventas",
    position: 0,
    isDefault: true,
  });
  await tdb.insertMany(
    stages,
    DEFAULT_STAGES.map((s, i) => ({
      id: newId(),
      pipelineId,
      name: s.name,
      position: i,
      color: s.color,
      isWon: s.isWon ?? false,
      isLost: s.isLost ?? false,
    })),
  );
  return pipelineId;
}

export async function listPipelines(ctx: TenantContext) {
  return tenantDb(ctx).select(pipelines).orderBy(asc(pipelines.position));
}

export async function getDefaultPipeline(ctx: TenantContext) {
  const rows = await tenantDb(ctx).select(
    pipelines,
    eq(pipelines.isDefault, true),
  );
  return rows[0] ?? null;
}

export async function listStages(ctx: TenantContext, pipelineId: string) {
  return tenantDb(ctx)
    .select(stages, eq(stages.pipelineId, pipelineId))
    .orderBy(asc(stages.position));
}

export async function createStage(
  ctx: TenantContext,
  input: { pipelineId: string; name: string; color?: string; position?: number },
): Promise<string> {
  const id = newId();
  await tenantDb(ctx).insert(stages, {
    id,
    pipelineId: input.pipelineId,
    name: input.name,
    color: input.color,
    position: input.position ?? 0,
  });
  return id;
}

export async function updateStage(
  ctx: TenantContext,
  stageId: string,
  set: { name?: string; color?: string; position?: number },
): Promise<void> {
  await tenantDb(ctx).update(stages, set, eq(stages.id, stageId));
}
