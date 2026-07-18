import { desc, eq, and } from "drizzle-orm";
import { flows, flowVersions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";
import { validateFlowGraph, getTriggerNode, type FlowGraph } from "./graph";

export type Flow = typeof flows.$inferSelect;
export type FlowVersion = typeof flowVersions.$inferSelect;

export async function createFlow(
  ctx: TenantContext,
  input: { name: string },
): Promise<string> {
  const id = newId();
  await tenantDb(ctx).insert(flows, {
    id,
    name: input.name,
    status: "draft",
    // Placeholder trigger config until the first version is saved; the graph
    // is the source of truth once a version exists.
    triggerType: "contact_created",
  });
  return id;
}

export async function listFlows(ctx: TenantContext) {
  return tenantDb(ctx).select(flows).orderBy(desc(flows.createdAt));
}

export async function getFlow(ctx: TenantContext, flowId: string) {
  const [row] = await tenantDb(ctx).select(flows, eq(flows.id, flowId));
  return row ?? null;
}

export async function listFlowVersions(ctx: TenantContext, flowId: string) {
  return tenantDb(ctx)
    .select(flowVersions, eq(flowVersions.flowId, flowId))
    .orderBy(desc(flowVersions.version));
}

// The published version: runs pin to this until a new one is published
// (PLAN.md §7.1). A flow can have unpublished draft versions sitting on top.
export async function getPublishedVersion(ctx: TenantContext, flowId: string) {
  const versions = await tenantDb(ctx).select(
    flowVersions,
    and(eq(flowVersions.flowId, flowId), eq(flowVersions.flowId, flowId))!,
  );
  const published = versions.filter((v) => v.publishedAt !== null);
  if (published.length === 0) return null;
  return published.reduce((latest, v) => (v.version > latest.version ? v : latest));
}

export async function getFlowVersion(
  ctx: TenantContext,
  versionId: string,
): Promise<FlowVersion | null> {
  const [row] = await tenantDb(ctx).select(
    flowVersions,
    eq(flowVersions.id, versionId),
  );
  return row ?? null;
}

// Validates the graph and creates a new immutable version (draft, not yet
// published). Editing a published flow always creates a NEW version — never
// mutates one that a running flow_run might be pinned to.
export async function saveDraftVersion(
  ctx: TenantContext,
  flowId: string,
  graph: unknown,
): Promise<string> {
  const validated = validateFlowGraph(graph);

  const existing = await tenantDb(ctx).select(
    flowVersions,
    eq(flowVersions.flowId, flowId),
  );
  const nextVersion = existing.reduce((max, v) => Math.max(max, v.version), 0) + 1;

  const id = newId();
  await tenantDb(ctx).insert(flowVersions, {
    id,
    flowId,
    version: nextVersion,
    graph: validated,
    publishedAt: null,
  });
  return id;
}

// Publishing stamps publishedAt and syncs the flow's trigger_type/config from
// the graph's trigger node, so trigger matching (engine.ts) doesn't need to
// load and parse the whole graph just to know what kind of flow this is.
export async function publishVersion(
  ctx: TenantContext,
  flowId: string,
  versionId: string,
): Promise<void> {
  const version = await getFlowVersion(ctx, versionId);
  if (!version || version.flowId !== flowId) {
    throw new Error("Versión no encontrada");
  }
  const graph = version.graph as FlowGraph;
  const trigger = getTriggerNode(graph);

  const tdb = tenantDb(ctx);
  await tdb.update(
    flowVersions,
    { publishedAt: new Date() },
    eq(flowVersions.id, versionId),
  );
  await tdb.update(
    flows,
    {
      status: "active",
      triggerType: trigger.type,
      triggerConfig: trigger.config as object,
    },
    eq(flows.id, flowId),
  );
}

export async function setFlowStatus(
  ctx: TenantContext,
  flowId: string,
  status: "draft" | "active" | "paused",
): Promise<void> {
  await tenantDb(ctx).update(flows, { status }, eq(flows.id, flowId));
}

// Active flows matching a trigger type — the entry point for engine.ts.
export async function listActiveFlowsForTrigger(
  ctx: TenantContext,
  triggerType: Flow["triggerType"],
) {
  return tenantDb(ctx).select(
    flows,
    and(eq(flows.status, "active"), eq(flows.triggerType, triggerType))!,
  );
}
