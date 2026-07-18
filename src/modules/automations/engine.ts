import { eq, and } from "drizzle-orm";
import { flowRuns, flowRunSteps } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb, type TenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";
import { enqueue } from "@/lib/queue";
import { getSubscription, listPlans } from "@/modules/billing/service";
import {
  getFlow,
  getPublishedVersion,
  getFlowVersion,
  listActiveFlowsForTrigger,
  type Flow,
} from "./flows";
import {
  getTriggerNode,
  getNode,
  outEdges,
  type FlowGraph,
} from "./graph";
import { evaluateCondition } from "./conditions";
import { executeAction, loadActionVars } from "./actions";
import { isContactOptedOut } from "./optout";

export const AUTOMATION_TRIGGER = "automation.trigger";
export const AUTOMATION_RESUME = "automation.resume";

const MAX_STEPS = 100;
const DEFAULT_WAIT_FOR_REPLY_MINUTES = 2 * 24 * 60; // 2 days

type ResumeSignal = { nodeId: string; kind: "delay" | "reply" | "timeout" };

// --- Triggering ---------------------------------------------------------------

// Fields relevant to trigger-config matching, extracted from the domain event
// by automations/jobs.ts before enqueueing — kept JSON-serializable (unlike a
// function callback) so it survives the AUTOMATION_TRIGGER job payload.
export type TriggerMatchFields = {
  formId?: string;
  pipelineId?: string;
  stageId?: string;
  tagId?: string;
  text?: string | null;
};

function matchesTriggerConfig(
  triggerType: Flow["triggerType"],
  config: unknown,
  fields: TriggerMatchFields,
): boolean {
  const c = (config ?? {}) as Record<string, unknown>;
  switch (triggerType) {
    case "wa_message": {
      const keyword = c.keyword as string | undefined;
      if (!keyword) return true;
      return (fields.text ?? "").toLowerCase().includes(keyword.toLowerCase());
    }
    case "form_submitted":
      return !c.formId || c.formId === fields.formId;
    case "deal_stage_changed":
      return (
        (!c.pipelineId || c.pipelineId === fields.pipelineId) &&
        (!c.stageId || c.stageId === fields.stageId)
      );
    case "tag_added":
      return !c.tagId || c.tagId === fields.tagId;
    case "contact_created":
      return true;
    default:
      return false;
  }
}

// Called by automations/jobs.ts's AUTOMATION_TRIGGER handler. Matches active
// flows of the given trigger type whose config matches the event, then starts
// a run for each — applying every PLAN.md §7.2 guard.
export async function triggerFlows(
  ctx: TenantContext,
  triggerType: Flow["triggerType"],
  event: {
    contactId: string;
    dealId?: string | null;
    payload: unknown;
    matchFields: TriggerMatchFields;
  },
): Promise<void> {
  const candidates = await listActiveFlowsForTrigger(ctx, triggerType);
  for (const flow of candidates) {
    if (!matchesTriggerConfig(triggerType, flow.triggerConfig, event.matchFields)) {
      continue;
    }
    await startRun(ctx, flow, event);
  }
}

async function startRun(
  ctx: TenantContext,
  flow: Flow,
  event: { contactId: string; dealId?: string | null; payload: unknown },
): Promise<void> {
  // Opt-out doesn't block a run from starting (non-send actions still make
  // sense for an opted-out contact); it only gates send actions inside
  // executeAction.

  const version = await getPublishedVersion(ctx, flow.id);
  if (!version) return; // flow marked active with no published version — no-op

  const tdb = tenantDb(ctx);

  const startedId = await tdb.transaction(async (tx) => {
    // Guard: at most one ACTIVE run per (flow, contact) — PLAN.md §7.2.
    // Row-locked read-then-write inside the transaction (same pattern as
    // worker/claim.ts's job queue locking).
    const active = await tx
      .select(
        flowRuns,
        and(
          eq(flowRuns.flowId, flow.id),
          eq(flowRuns.contactId, event.contactId),
        )!,
      )
      .for("update");
    if (active.some((r) => r.status === "running" || r.status === "waiting")) {
      return null;
    }

    // Guard: per-tenant automation-run cap from plan limits, if configured.
    if (await tenantRunCapExceeded(tx, ctx.tenantId)) {
      return null;
    }

    const graph = version.graph as FlowGraph;
    const trigger = getTriggerNode(graph);
    const runId = newId();
    await tx.insert(flowRuns, {
      id: runId,
      flowId: flow.id,
      flowVersionId: version.id,
      contactId: event.contactId,
      status: "running",
      currentNodeId: trigger.id,
      context: { trigger: event.payload, dealId: event.dealId ?? null } as object,
      startedBy: event.payload as object,
      stepCount: 0,
    });
    return runId;
  });

  if (!startedId) return;
  await advanceRun(ctx, startedId);
}

async function tenantRunCapExceeded(
  tdb: TenantDb,
  tenantId: string,
): Promise<boolean> {
  const subscription = await getSubscription(tenantId);
  if (!subscription || subscription.status !== "active") return false;
  const plan = (await listPlans()).find((p) => p.id === subscription.planId);
  const limits = plan?.limits as { automationRunsPerMonth?: number } | null;
  if (!limits?.automationRunsPerMonth) return false;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const allRuns = await tdb.select(flowRuns);
  const countThisMonth = allRuns.filter(
    (r) => r.createdAt.getTime() >= monthStart.getTime(),
  ).length;
  return countThisMonth >= limits.automationRunsPerMonth;
}

// --- Step loop -----------------------------------------------------------------

async function loadRun(ctx: TenantContext, runId: string) {
  const [run] = await tenantDb(ctx).select(flowRuns, eq(flowRuns.id, runId));
  return run ?? null;
}

async function writeStep(
  ctx: TenantContext,
  runId: string,
  nodeId: string,
  status: "ok" | "error" | "skipped",
  result: unknown,
): Promise<void> {
  await tenantDb(ctx).insert(flowRunSteps, {
    id: newId(),
    runId,
    nodeId,
    status,
    result: result as object,
  });
}

async function finishRun(
  ctx: TenantContext,
  runId: string,
  status: "completed" | "failed" | "cancelled",
): Promise<void> {
  await tenantDb(ctx).update(flowRuns, { status }, eq(flowRuns.id, runId));
}

// Advances a run from its current node until it completes, fails, or parks at
// a delay/wait-for-reply node. `resume` is set only when this call originates
// from a resume job/reply and identifies exactly which waiting node is being
// resolved and how (PLAN.md §7.2). This is the interpreter's whole job:
// execute node -> write flow_run_steps -> advance edge, entirely resumable
// from persisted state — no in-memory workflow runtime.
export async function advanceRun(
  ctx: TenantContext,
  runId: string,
  resume?: ResumeSignal,
): Promise<void> {
  const run = await loadRun(ctx, runId);
  if (!run) return;
  if (run.status !== "running" && !(run.status === "waiting" && resume)) return;

  const version = await getFlowVersion(ctx, run.flowVersionId);
  if (!version) {
    await finishRun(ctx, runId, "failed");
    return;
  }
  const graph = version.graph as FlowGraph;
  const context = (run.context ?? {}) as { trigger?: unknown; dealId?: string | null };
  const dealId = context.dealId ?? null;

  let currentNodeId = run.currentNodeId;
  let stepCount = run.stepCount;
  let pendingResume = resume;

  // When resuming, the CAS in resumeRun() already flipped status to
  // "running" — this call only ever runs after that succeeded.

  while (currentNodeId) {
    if (stepCount >= MAX_STEPS) {
      await writeStep(ctx, runId, currentNodeId, "error", { reason: "max steps exceeded" });
      await finishRun(ctx, runId, "failed");
      return;
    }

    const node = getNode(graph, currentNodeId);
    if (!node) {
      await writeStep(ctx, runId, currentNodeId, "error", { reason: "node not found" });
      await finishRun(ctx, runId, "failed");
      return;
    }

    if (node.kind === "trigger") {
      const edges = outEdges(graph, node.id);
      currentNodeId = edges[0]?.target ?? null;
      if (!currentNodeId) {
        await finishRun(ctx, runId, "completed");
        return;
      }
      continue;
    }

    if (node.kind === "delay") {
      const isResumingThisNode =
        pendingResume && pendingResume.nodeId === node.id;

      if (!isResumingThisNode) {
        // Fresh arrival: park the run.
        const minutes =
          node.type === "wait_for_reply"
            ? Number((node.config as Record<string, unknown>).timeoutMinutes) ||
              DEFAULT_WAIT_FOR_REPLY_MINUTES
            : Number((node.config as Record<string, unknown>).durationMinutes) || 60;
        const waitUntil = new Date(Date.now() + minutes * 60_000);

        await tenantDb(ctx).update(
          flowRuns,
          {
            status: "waiting",
            currentNodeId: node.id,
            waitFor: node.type === "wait_for_reply" ? "reply" : "delay",
            waitUntil,
            stepCount,
          },
          eq(flowRuns.id, runId),
        );
        await writeStep(ctx, runId, node.id, "ok", { action: "enter_wait", waitUntil });

        // Schedule the resume job — for wait_for_reply this is the TIMEOUT
        // side of the race; the REPLY side is resolved by the inbound-message
        // handler calling resumeRun directly (automations/inbound.ts).
        await enqueue(
          AUTOMATION_RESUME,
          {
            runId,
            nodeId: node.id,
            kind: node.type === "wait_for_reply" ? "timeout" : "delay",
          },
          { tenantId: ctx.tenantId, runAt: waitUntil },
        );
        return;
      }

      // Resuming: pick the branch for how we got woken up.
      const handle =
        node.type === "wait_for_reply" ? pendingResume!.kind : undefined;
      const edges = outEdges(graph, node.id, handle === "delay" ? undefined : handle);
      await writeStep(ctx, runId, node.id, "ok", { resumedVia: pendingResume!.kind });
      stepCount += 1;
      pendingResume = undefined;
      currentNodeId = edges[0]?.target ?? null;
      if (!currentNodeId) {
        await finishRun(ctx, runId, "completed");
        return;
      }
      continue;
    }

    if (node.kind === "condition") {
      const branch = await evaluateCondition(ctx, node, {
        contactId: run.contactId,
        dealId,
      });
      await writeStep(ctx, runId, node.id, "ok", { branch });
      stepCount += 1;
      const edges = outEdges(graph, node.id, branch);
      currentNodeId = edges[0]?.target ?? null;
      if (!currentNodeId) {
        await finishRun(ctx, runId, "completed");
        return;
      }
      continue;
    }

    // action node
    const vars = await loadActionVars(ctx, run.contactId, dealId, context.trigger);
    let outcome: { status: "ok" | "skipped" | "error"; result: unknown };
    try {
      outcome = await executeAction(ctx, node, {
        contactId: run.contactId,
        dealId,
        runId,
        vars,
      });
    } catch (err) {
      await writeStep(ctx, runId, node.id, "error", {
        message: err instanceof Error ? err.message : String(err),
      });
      await finishRun(ctx, runId, "failed");
      return;
    }
    await writeStep(ctx, runId, node.id, outcome.status, outcome.result);
    stepCount += 1;

    // Persist progress after every step so a mid-run crash resumes from the
    // last completed node, not the run's original start.
    await tenantDb(ctx).update(
      flowRuns,
      { currentNodeId: node.id, stepCount },
      eq(flowRuns.id, runId),
    );

    const edges = outEdges(graph, node.id);
    currentNodeId = edges[0]?.target ?? null;
    if (!currentNodeId) {
      await finishRun(ctx, runId, "completed");
      return;
    }
  }

  await finishRun(ctx, runId, "completed");
}

// --- Resume (race-safe) ---------------------------------------------------------

// Compare-and-set resume: only proceeds if the run is still `waiting` at the
// moment of the call. Two callers can race here — an inbound reply and a
// timeout job firing back-to-back — and exactly one of them wins the UPDATE
// (PLAN.md §7.2: "resolve the race by compare-and-set on flow_runs.status").
// The loser's UPDATE affects zero rows and returns immediately.
export async function resumeRun(
  ctx: TenantContext,
  runId: string,
  signal: ResumeSignal,
): Promise<boolean> {
  const [result] = await tenantDb(ctx).update(
    flowRuns,
    { status: "running", waitFor: null, waitUntil: null },
    and(
      eq(flowRuns.id, runId),
      eq(flowRuns.status, "waiting"),
      eq(flowRuns.currentNodeId, signal.nodeId),
    )!,
  );
  const affectedRows = (result as { affectedRows?: number }).affectedRows ?? 0;
  if (affectedRows === 0) return false; // lost the race, or already resolved

  await advanceRun(ctx, runId, signal);
  return true;
}

// --- Cancellation ("stop on reply" guard) ---------------------------------------

export async function cancelRun(ctx: TenantContext, runId: string): Promise<void> {
  await finishRun(ctx, runId, "cancelled");
}

// All runs for a flow, newest first — the monitoring UI (PLAN.md §7.2: runs
// list per flow with status, contact, current node, errors).
export async function listRunsForFlow(ctx: TenantContext, flowId: string) {
  const runs = await tenantDb(ctx).select(flowRuns, eq(flowRuns.flowId, flowId));
  return runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getRun(ctx: TenantContext, runId: string) {
  return loadRun(ctx, runId);
}

export async function listRunSteps(ctx: TenantContext, runId: string) {
  const steps = await tenantDb(ctx).select(flowRunSteps, eq(flowRunSteps.runId, runId));
  return steps.sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
}

// Active (running or waiting) runs for a contact, across all flows — used by
// the inbound-reply handler to resume wait_for_reply nodes and apply the
// "stop on reply" guard to every other active run (PLAN.md §7.2).
export async function listActiveRunsForContact(ctx: TenantContext, contactId: string) {
  const runs = await tenantDb(ctx).select(flowRuns, eq(flowRuns.contactId, contactId));
  return runs.filter((r) => r.status === "running" || r.status === "waiting");
}

export { getFlow, isContactOptedOut };
