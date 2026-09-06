"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantContext, requireTenantAdmin } from "@/modules/tenancy/context";
import { moveDeal, createDeal } from "@/modules/crm/deals";
import { RecordDeleteError, deleteDealRecord } from "@/modules/crm/deletion";
import { writeAuditLog } from "@/modules/tenancy/audit";
import {
  StageConfigError,
  createPipelineWithDefaultStages,
  createStage,
  deleteStageIfEmpty,
  listStagesForPipeline,
  moveStage,
  updateStage,
} from "@/modules/crm/pipelines";

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
  const ctx = await requireTenantContext();
  const parsed = moveDealSchema.parse(input);
  await moveDeal(ctx, parsed.dealId, { toStageId: parsed.toStageId, toPosition: parsed.toPosition });
  revalidatePath("/pipeline");
}

// The create-deal form is useActionState-shaped (PLAN.md §10 1R #6): a bad
// value or a missing title comes back as state rendered next to the input,
// not as Next's generic error page. The state carries a message *key* that
// the client resolves through next-intl — no copy lives in this file.
export type DealField = "title" | "contactId" | "stageId" | "value";

export type DealFormState = {
  error: string | null;
  field: DealField | null;
  created: boolean;
  /** Echoed back so a rejected submit doesn't blank the form: React resets
   * an uncontrolled form once its action resolves, and the client feeds
   * these back in as defaultValue. */
  values: Record<string, string>;
};

const DEAL_FIELD_ERRORS: Record<DealField, string> = {
  title: "titleRequired",
  contactId: "contactRequired",
  stageId: "stageRequired",
  value: "valueInvalid",
};

const createDealSchema = z.object({
  contactId: z.string().min(1),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  title: z.string().min(1).max(200),
  // Guaraníes are integer minor units (§2.3) — a "1.5" typed into the value
  // box is a user mistake with a message, not a server crash.
  value: z.coerce.number().int().min(0).optional(),
});

export async function createDealAction(
  _prevState: DealFormState,
  formData: FormData,
): Promise<DealFormState> {
  const ctx = await requireTenantContext();
  const parsed = createDealSchema.safeParse({
    contactId: formData.get("contactId"),
    pipelineId: formData.get("pipelineId"),
    stageId: formData.get("stageId"),
    title: formData.get("title"),
    value: formData.get("value") || undefined,
  });

  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (typeof field === "string" && field in DEAL_FIELD_ERRORS) {
      const key = field as DealField;
      return { error: DEAL_FIELD_ERRORS[key], field: key, created: false, values };
    }
    // pipelineId comes from a hidden input, so a failure there is not a
    // field the user can fix — it belongs in the form-level slot.
    return { error: "unknown", field: null, created: false, values };
  }

  try {
    await createDeal(ctx, parsed.data);
  } catch {
    return { error: "unknown", field: null, created: false, values };
  }

  revalidatePath("/pipeline");
  // Cleared on success: the deal is now a card on the board above.
  return { error: null, field: null, created: true, values: {} };
}

const createPipelineSchema = z.object({
  name: z.string().min(1).max(100),
});

// Pipeline *config* is admin-only (§3.2) — adding a pipeline reshapes how the
// whole tenant sells. Working the board is not: moveDealAction and
// createDealAction above stay agent-accessible, which is the daily job.
export async function createPipelineAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const input = createPipelineSchema.parse({ name: formData.get("name") });
  const pipeline = await createPipelineWithDefaultStages(ctx, input.name);
  revalidatePath("/pipeline");
  if (pipeline) redirect(`/pipeline?pipeline=${pipeline.id}`);
}


// --- Stage configuration (PLAN.md §13 H8) -------------------------------
//
// Admin-only, per §3.2 and H1: renaming or deleting a stage is tenant
// configuration, not deal work. Every one of these is a hidden-id button in
// a rendered row, so a refusal has nowhere to render — the guards below
// return silently and the page re-renders with the unchanged state, except
// for delete, which reports why it refused.

const stageIdSchema = z.object({ stageId: z.string().min(1).max(26) });

export async function updateStageAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z
    .object({
      stageId: z.string().min(1).max(26),
      name: z.string().trim().min(1).max(200),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
      outcome: z.enum(["none", "won", "lost"]),
      staleAfterDays: z.coerce.number().int().min(1).max(365).nullable(),
    })
    .safeParse({
      stageId: formData.get("stageId"),
      name: formData.get("name"),
      color: formData.get("color") || undefined,
      outcome: formData.get("outcome") ?? "none",
      staleAfterDays: formData.get("staleAfterDays") || null,
    });
  if (!parsed.success) return;

  await updateStage(ctx, parsed.data.stageId, {
    name: parsed.data.name,
    color: parsed.data.color || null,
    isWon: parsed.data.outcome === "won",
    isLost: parsed.data.outcome === "lost",
    staleAfterDays: parsed.data.staleAfterDays,
  });

  revalidatePath("/pipeline");
}

export async function moveStageAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z
    .object({ stageId: z.string().min(1).max(26), direction: z.enum(["left", "right"]) })
    .safeParse({ stageId: formData.get("stageId"), direction: formData.get("direction") });
  if (!parsed.success) return;

  await moveStage(ctx, parsed.data.stageId, parsed.data.direction);
  revalidatePath("/pipeline");
}

export async function deleteStageAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = stageIdSchema.safeParse({ stageId: formData.get("stageId") });
  if (!parsed.success) return;

  try {
    await deleteStageIfEmpty(ctx, parsed.data.stageId);
  } catch (err) {
    if (err instanceof StageConfigError) {
      // "It still holds deals" is the answer the admin needs, and it is not
      // secret — it comes back in the URL so the page can say it.
      redirect(`/pipeline/etapas?error=${err.code}`);
    }
    throw err;
  }

  redirect("/pipeline/etapas");
}

export async function createStageAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z
    .object({
      pipelineId: z.string().min(1).max(26),
      name: z.string().trim().min(1).max(200),
    })
    .safeParse({ pipelineId: formData.get("pipelineId"), name: formData.get("name") });
  if (!parsed.success) return;

  const existing = await listStagesForPipeline(ctx, parsed.data.pipelineId);
  await createStage(ctx, {
    pipelineId: parsed.data.pipelineId,
    name: parsed.data.name,
    position: existing.length,
  });

  revalidatePath("/pipeline");
}

// Deleting a deal opened by mistake. Same contract as deleteStageAction
// above — admin-only, refuses while anything real hangs off it, and says
// which thing in the URL (modules/crm/deletion.ts).
export async function deleteDealAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z.string().min(1).max(26).safeParse(formData.get("dealId"));
  if (!parsed.success) return;
  const dealId = parsed.data;

  try {
    await deleteDealRecord(ctx, dealId);
  } catch (err) {
    if (err instanceof RecordDeleteError) {
      if (err.code === "notFound") redirect("/pipeline");
      redirect(`/pipeline/${dealId}?deleteError=${err.blockers.join(",")}`);
    }
    throw err;
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "deal.deleted",
    entity: "deal",
    entityId: dealId,
  });

  revalidatePath("/pipeline");
  redirect("/pipeline");
}
