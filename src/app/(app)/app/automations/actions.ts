"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenantContext } from "@/modules/tenancy/context";
import { assertWritable } from "@/modules/tenancy/access";
import {
  createFlow,
  saveDraftVersion,
  publishVersion,
  setFlowStatus,
} from "@/modules/automations/flows";
import { cancelRun } from "@/modules/automations/engine";
import { GraphValidationError } from "@/modules/automations/graph";

async function writableCtx() {
  const ctx = await requireTenantContext();
  await assertWritable(ctx.tenantId);
  return ctx;
}

const createSchema = z.object({ name: z.string().min(1) });

export async function createFlowAction(formData: FormData) {
  const ctx = await writableCtx();
  const input = createSchema.parse({ name: formData.get("name") });
  const flowId = await createFlow(ctx, input);
  revalidatePath("/app/automations");
  redirect(`/app/automations/${flowId}`);
}

export type SaveGraphState = { error: string | null; savedAt: number | null };

export async function saveDraftAction(
  flowId: string,
  graph: unknown,
): Promise<SaveGraphState> {
  const ctx = await writableCtx();
  try {
    await saveDraftVersion(ctx, flowId, graph);
  } catch (err) {
    if (err instanceof GraphValidationError) {
      return { error: err.message, savedAt: null };
    }
    throw err;
  }
  revalidatePath(`/app/automations/${flowId}`);
  return { error: null, savedAt: Date.now() };
}

export async function publishVersionAction(
  flowId: string,
  versionId: string,
): Promise<{ error: string | null }> {
  const ctx = await writableCtx();
  try {
    await publishVersion(ctx, flowId, versionId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath(`/app/automations/${flowId}`);
  revalidatePath("/app/automations");
  return { error: null };
}

export async function setFlowStatusAction(flowId: string, status: "active" | "paused") {
  const ctx = await writableCtx();
  await setFlowStatus(ctx, flowId, status);
  revalidatePath("/app/automations");
  revalidatePath(`/app/automations/${flowId}`);
}

export async function cancelRunAction(flowId: string, runId: string) {
  const ctx = await writableCtx();
  await cancelRun(ctx, runId);
  revalidatePath(`/app/automations/${flowId}/runs`);
}
