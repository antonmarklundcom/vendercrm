"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantOperator } from "@/modules/tenancy/context";
import { createFlow, saveDraft, publishFlow, setFlowStatus } from "@/modules/automations/flows";
import { cancelRun } from "@/modules/automations/engine";
import { flowGraphSchema, TRIGGER_TYPES } from "@/modules/automations/graph";

const createFlowSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum(TRIGGER_TYPES),
});

export async function createFlowAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const input = createFlowSchema.parse({
    name: formData.get("name"),
    triggerType: formData.get("triggerType"),
  });
  const flow = await createFlow(ctx, input);
  revalidatePath("/automations");
  redirect(`/automations/${flow!.id}`);
}

/** Called from the editor with the canvas graph as JSON. */
export async function saveDraftAction(flowId: string, graphJson: string) {
  const ctx = await requireTenantOperator();
  const graph = flowGraphSchema.parse(JSON.parse(graphJson));
  await saveDraft(ctx, flowId, graph);
  revalidatePath(`/automations/${flowId}`);
}

export async function publishFlowAction(flowId: string) {
  const ctx = await requireTenantOperator();
  const result = await publishFlow(ctx, flowId);
  revalidatePath(`/automations/${flowId}`);
  // Validation errors are shown in the editor, so they're returned rather
  // than thrown — a failed publish is an expected outcome, not a crash.
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
}

export async function setFlowStatusAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const flowId = z.string().min(1).parse(formData.get("flowId"));
  const status = z.enum(["draft", "active", "paused"]).parse(formData.get("status"));
  await setFlowStatus(ctx, flowId, status);
  revalidatePath(`/automations/${flowId}`);
}

export async function cancelRunAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const runId = z.string().min(1).parse(formData.get("runId"));
  const flowId = z.string().min(1).parse(formData.get("flowId"));
  await cancelRun(ctx, runId);
  revalidatePath(`/automations/${flowId}`);
}
