"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/tenancy/context";
import { DealCloseError, assignDeal, closeDeal, reopenDeal, updateDeal } from "@/modules/crm/deals";

// Deal detail actions (PLAN.md §13 H8). Working a deal is the agent's daily
// job, so these stay agent-accessible — §3.2 reserves *pipeline
// configuration* for admins, which is the stage editor, not this.

export type CloseDealState = { error: string | null; closed: boolean };

const closeSchema = z.object({
  dealId: z.string().min(1).max(26),
  outcome: z.enum(["won", "lost"]),
  reason: z.string().max(500).optional(),
});

export async function closeDealAction(
  _prevState: CloseDealState,
  formData: FormData,
): Promise<CloseDealState> {
  const ctx = await requireTenantContext();

  const parsed = closeSchema.safeParse({
    dealId: formData.get("dealId"),
    outcome: formData.get("outcome"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { error: "invalid", closed: false };

  try {
    await closeDeal(ctx, parsed.data.dealId, parsed.data.outcome, parsed.data.reason);
  } catch (err) {
    // "This pipeline has no won/lost stage" is a real, fixable answer — the
    // stage editor is where it gets fixed — so it comes back as copy rather
    // than as an error page.
    if (err instanceof DealCloseError) return { error: err.code, closed: false };
    return { error: "unknown", closed: false };
  }

  revalidatePath(`/pipeline/${parsed.data.dealId}`);
  revalidatePath("/pipeline");
  return { error: null, closed: true };
}

const reopenSchema = z.object({
  dealId: z.string().min(1).max(26),
  toStageId: z.string().min(1).max(26),
});

export async function reopenDealAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = reopenSchema.safeParse({
    dealId: formData.get("dealId"),
    toStageId: formData.get("toStageId"),
  });
  if (!parsed.success) return;

  await reopenDeal(ctx, parsed.data.dealId, parsed.data.toStageId);
  revalidatePath(`/pipeline/${parsed.data.dealId}`);
  revalidatePath("/pipeline");
}

const assignSchema = z.object({
  dealId: z.string().min(1).max(26),
  userId: z.string().min(1).max(26),
});

export async function assignDealAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = assignSchema.safeParse({
    dealId: formData.get("dealId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return;

  await assignDeal(ctx, parsed.data.dealId, parsed.data.userId);
  revalidatePath(`/pipeline/${parsed.data.dealId}`);
}

const expectedCloseSchema = z.object({
  dealId: z.string().min(1).max(26),
  expectedCloseAt: z.string(),
});

/** Pipeline forecasting (§15.8 P5). Empty input clears the date. */
export async function updateExpectedCloseAtAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = expectedCloseSchema.safeParse({
    dealId: formData.get("dealId"),
    expectedCloseAt: formData.get("expectedCloseAt") ?? "",
  });
  if (!parsed.success) return;

  const date = parsed.data.expectedCloseAt ? new Date(parsed.data.expectedCloseAt) : null;
  if (date && Number.isNaN(date.getTime())) return;

  await updateDeal(ctx, parsed.data.dealId, { expectedCloseAt: date });
  revalidatePath(`/pipeline/${parsed.data.dealId}`);
}
