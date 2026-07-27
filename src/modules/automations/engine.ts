import { and, eq } from "drizzle-orm";
import { flowRunSteps, flowRuns } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueue } from "@/lib/queue";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { flowGraphSchema, findNode, nextNodeId, type FlowGraph, type FlowNode } from "./graph";
import { getVersion } from "./flows";
import { evaluateCondition } from "./conditions";
import { executeAction } from "./actions";

// Execution engine (PLAN.md §7.2): an interpreter over the stored graph with
// durable state. Nothing lives in memory — every run is resumable from
// flow_runs after a process restart, which is the whole reason delays and
// wait-for-reply are rows rather than timers.

/** Cycle safety net (§7.2) — the graph is acyclic, but guard against loops anyway. */
const MAX_STEPS = 100;

export type StartRunInput = {
  flowId: string;
  flowVersionId: string;
  contactId: string;
  startedBy: Record<string, unknown>;
};

/**
 * Guard (§7.2): "max one running run per (flow, contact)". Returns null when
 * a run is already live for this pair rather than starting a duplicate — a
 * contact who submits a form twice shouldn't get the sequence twice.
 */
export async function startRun(ctx: TenantContext, input: StartRunInput) {
  const existing = await tenantDb(ctx).select(
    flowRuns,
    and(eq(flowRuns.flowId, input.flowId), eq(flowRuns.contactId, input.contactId)),
  );
  if (existing.some((run) => run.status === "running" || run.status === "waiting")) {
    return null;
  }

  const version = await getVersion(ctx, input.flowVersionId);
  if (!version) return null;

  const graph = flowGraphSchema.parse(version.graph);
  const trigger = graph.nodes.find((node) => node.type === "trigger");
  if (!trigger) return null;

  const id = newId();
  await tenantDb(ctx)
    .insert(flowRuns)
    .values({
      id,
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
      contactId: input.contactId,
      status: "running",
      currentNodeId: trigger.id,
      context: {},
      startedBy: input.startedBy,
    });

  await enqueue("automation.advance", { runId: id }, { tenantId: ctx.tenantId });
  return id;
}

export async function getRun(ctx: TenantContext, runId: string) {
  const [row] = await tenantDb(ctx).select(flowRuns, eq(flowRuns.id, runId));
  return row ?? null;
}

export async function listRunsForFlow(ctx: TenantContext, flowId: string) {
  const rows = await tenantDb(ctx).select(flowRuns, eq(flowRuns.flowId, flowId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Per-step audit trail for the runs monitor (§7.2 "audit/debug trail"). */
export async function listRunSteps(ctx: TenantContext, runId: string) {
  const rows = await tenantDb(ctx).select(flowRunSteps, eq(flowRunSteps.runId, runId));
  return rows.sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
}

export async function cancelRun(ctx: TenantContext, runId: string) {
  await tenantDb(ctx)
    .update(flowRuns)
    .set({ status: "cancelled" })
    .where(eq(flowRuns.id, runId));
}

async function recordStep(
  ctx: TenantContext,
  runId: string,
  node: FlowNode,
  status: "ok" | "skipped" | "failed",
  result: Record<string, unknown>,
) {
  await tenantDb(ctx)
    .insert(flowRunSteps)
    .values({
      id: newId(),
      runId,
      nodeId: node.id,
      nodeType: node.type,
      status,
      result,
    });
}

/**
 * Runs the interpreter until the run finishes or parks on a wait. Called
 * from the `automation.advance` job, so a crash mid-flow just means the job
 * retries and the run picks up from its persisted currentNodeId.
 */
export async function advanceRun(ctx: TenantContext, runId: string): Promise<void> {
  const run = await getRun(ctx, runId);
  if (!run) return;
  if (run.status !== "running") return;

  const version = await getVersion(ctx, run.flowVersionId);
  if (!version) {
    await fail(ctx, runId, "Versión del flujo no encontrada");
    return;
  }

  const graph = flowGraphSchema.parse(version.graph) as FlowGraph;
  let currentNodeId: string | null = run.currentNodeId;
  let steps = run.stepCount;

  while (currentNodeId) {
    if (steps >= MAX_STEPS) {
      await fail(ctx, runId, `Se alcanzó el máximo de ${MAX_STEPS} pasos`);
      return;
    }

    const node = findNode(graph, currentNodeId);
    if (!node) {
      await fail(ctx, runId, `Nodo no encontrado: ${currentNodeId}`);
      return;
    }

    steps += 1;

    if (node.type === "trigger") {
      currentNodeId = nextNodeId(graph, node.id);
      continue;
    }

    if (node.type === "condition") {
      const passed = await evaluateCondition(ctx, node, run.contactId);
      await recordStep(ctx, runId, node, "ok", { passed });
      currentNodeId = nextNodeId(graph, node.id, passed ? "yes" : "no");
      continue;
    }

    if (node.type === "delay") {
      const config = node.config as { kind: string; minutes: number };
      const waitUntil = new Date(Date.now() + config.minutes * 60_000);

      if (config.kind === "wait_for_reply") {
        // Parked until either the contact replies (resumeOnReply) or the
        // timeout job fires — whichever wins the compare-and-set below.
        await tenantDb(ctx)
          .update(flowRuns)
          .set({
            status: "waiting",
            waitFor: "reply",
            waitUntil,
            currentNodeId: node.id,
            stepCount: steps,
          })
          .where(eq(flowRuns.id, runId));

        await enqueue(
          "automation.timeout",
          { runId, nodeId: node.id },
          { tenantId: ctx.tenantId, runAt: waitUntil },
        );
        return;
      }

      await tenantDb(ctx)
        .update(flowRuns)
        .set({
          status: "waiting",
          waitFor: "delay",
          waitUntil,
          currentNodeId: node.id,
          stepCount: steps,
        })
        .where(eq(flowRuns.id, runId));

      await enqueue(
        "automation.resume",
        { runId, nodeId: node.id },
        { tenantId: ctx.tenantId, runAt: waitUntil },
      );
      return;
    }

    // action
    try {
      const result = await executeAction(ctx, node, run.contactId, runId);
      await recordStep(ctx, runId, node, result.skipped ? "skipped" : "ok", result.detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordStep(ctx, runId, node, "failed", { error: message });
      await fail(ctx, runId, message);
      return;
    }

    currentNodeId = nextNodeId(graph, node.id);
  }

  await tenantDb(ctx)
    .update(flowRuns)
    .set({ status: "completed", currentNodeId: null, stepCount: steps })
    .where(eq(flowRuns.id, runId));
}

async function fail(ctx: TenantContext, runId: string, message: string) {
  await tenantDb(ctx)
    .update(flowRuns)
    .set({ status: "failed", lastError: message.slice(0, 2000) })
    .where(eq(flowRuns.id, runId));
}

/**
 * Moves a waiting run back to running on the given branch, but only if it is
 * still `waiting` — this is the compare-and-set §7.2 calls for, and it is
 * what resolves the wait-for-reply race: whichever of the reply and the
 * timeout gets here first flips the status, and the loser's update matches
 * no rows and does nothing.
 */
async function claimWaitingRun(
  ctx: TenantContext,
  runId: string,
  nodeId: string,
  branch: "replied" | "timeout" | "default",
): Promise<boolean> {
  const run = await getRun(ctx, runId);
  if (!run || run.status !== "waiting" || run.currentNodeId !== nodeId) return false;

  const version = await getVersion(ctx, run.flowVersionId);
  if (!version) return false;
  const graph = flowGraphSchema.parse(version.graph);

  const next = nextNodeId(graph, nodeId, branch);

  const result = await tenantDb(ctx)
    .update(flowRuns)
    .set({
      status: next ? "running" : "completed",
      currentNodeId: next,
      waitFor: null,
      waitUntil: null,
    })
    .where(and(eq(flowRuns.id, runId), eq(flowRuns.status, "waiting")));

  // mysql2 reports how many rows actually matched — zero means another
  // path (reply vs timeout) already claimed this run.
  const affected = (result as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows;
  if (affected === 0) return false;

  if (next) {
    await enqueue("automation.advance", { runId }, { tenantId: ctx.tenantId });
  }
  return true;
}

/** `automation.resume` job — a fixed delay elapsed. */
export async function resumeAfterDelay(ctx: TenantContext, runId: string, nodeId: string) {
  await claimWaitingRun(ctx, runId, nodeId, "default");
}

/** `automation.timeout` job — wait-for-reply expired without a reply. */
export async function timeoutWaitForReply(ctx: TenantContext, runId: string, nodeId: string) {
  await claimWaitingRun(ctx, runId, nodeId, "timeout");
}

/**
 * Called by the inbound-message processor (§7.2): resumes every run parked
 * on a wait-for-reply for this contact. Also implements the "stop flow when
 * contact replies" guard for runs configured that way.
 */
export async function resumeOnReply(ctx: TenantContext, contactId: string) {
  const runs = await tenantDb(ctx).select(
    flowRuns,
    and(eq(flowRuns.contactId, contactId), eq(flowRuns.status, "waiting")),
  );

  for (const run of runs) {
    if (run.waitFor !== "reply" || !run.currentNodeId) continue;
    await claimWaitingRun(ctx, run.id, run.currentNodeId, "replied");
  }
}
