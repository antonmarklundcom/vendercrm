import type { TenantContext } from "@/modules/tenancy/types";
import { listActiveRunsForContact, resumeRun, cancelRun } from "./engine";
import { getFlow } from "./flows";
import { isOptoutMessage, applyOptout } from "./optout";

// Called for every inbound WhatsApp message (PLAN.md §7.2): auto-applies the
// opt-out tag on BAJA/STOP, resumes any run parked at a wait_for_reply node
// waiting on exactly this contact, and cancels the contact's other active
// runs whose flow has `stopOnReply` — "reply moves the run forward or ends
// it", never leaves it silently stale.
export async function handleInboundReply(
  ctx: TenantContext,
  contactId: string,
  text: string | null,
): Promise<void> {
  if (isOptoutMessage(text)) {
    await applyOptout(ctx, contactId);
  }

  const activeRuns = await listActiveRunsForContact(ctx, contactId);
  for (const run of activeRuns) {
    const isWaitingForThisReply =
      run.status === "waiting" && run.waitFor === "reply" && run.currentNodeId;

    if (isWaitingForThisReply) {
      await resumeRun(ctx, run.id, {
        nodeId: run.currentNodeId!,
        kind: "reply",
      });
      continue;
    }

    const flow = await getFlow(ctx, run.flowId);
    if (flow?.stopOnReply) {
      await cancelRun(ctx, run.id);
    }
  }
}
