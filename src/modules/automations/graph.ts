import { z } from "zod";

// The flow graph shape (PLAN.md §7.1). A flow = one trigger node + a DAG of
// steps. Stored as JSON on flow_versions.graph; validated with this schema on
// every save so a bad graph can never reach the execution engine.

const triggerNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("trigger"),
  position: z.object({ x: z.number(), y: z.number() }),
  type: z.enum([
    "wa_message",
    "form_submitted",
    "deal_stage_changed",
    "contact_created",
    "tag_added",
  ]),
  config: z.record(z.string(), z.unknown()).default({}),
});

const conditionNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("condition"),
  position: z.object({ x: z.number(), y: z.number() }),
  type: z.enum([
    "contact_field",
    "contact_tag",
    "deal_stage",
    "business_hours",
    "has_responded_since",
  ]),
  config: z.record(z.string(), z.unknown()).default({}),
});

const actionNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("action"),
  position: z.object({ x: z.number(), y: z.number() }),
  type: z.enum([
    "send_wa_message",
    "send_wa_template",
    "add_tag",
    "remove_tag",
    "move_deal_stage",
    "assign_user",
    "create_activity",
    "notify_user",
  ]),
  config: z.record(z.string(), z.unknown()).default({}),
});

const delayNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("delay"),
  position: z.object({ x: z.number(), y: z.number() }),
  type: z.enum(["wait_duration", "wait_for_reply"]),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const flowNodeSchema = z.discriminatedUnion("kind", [
  triggerNodeSchema,
  conditionNodeSchema,
  actionNodeSchema,
  delayNodeSchema,
]);

export type FlowNode = z.infer<typeof flowNodeSchema>;
export type TriggerNode = z.infer<typeof triggerNodeSchema>;

// Edges connect node -> node. `sourceHandle` distinguishes branches: condition
// nodes emit "yes"/"no"; wait_for_reply emits "replied"/"timeout". Simple
// linear nodes (trigger/action/wait_duration) have a single unlabeled out edge.
export const flowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
});

export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema).min(1),
  edges: z.array(flowEdgeSchema),
});

export type FlowGraph = z.infer<typeof flowGraphSchema>;

export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphValidationError";
  }
}

// Structural validation beyond what zod's shape checks can express: exactly
// one trigger, every non-trigger node reachable from it, no cycles, no edges
// pointing at nonexistent nodes (PLAN.md §7.1).
export function validateFlowGraph(input: unknown): FlowGraph {
  const graph = flowGraphSchema.parse(input);

  const triggers = graph.nodes.filter((n) => n.kind === "trigger");
  if (triggers.length !== 1) {
    throw new GraphValidationError(
      `El flujo debe tener exactamente un disparador (tiene ${triggers.length})`,
    );
  }
  const trigger = triggers[0];

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (nodeIds.size !== graph.nodes.length) {
    throw new GraphValidationError("Hay nodos con id duplicado");
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new GraphValidationError(
        `Una conexión referencia un nodo inexistente (${edge.source} -> ${edge.target})`,
      );
    }
  }

  // Reachability from the trigger (BFS) — catches orphan nodes.
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }
  const reached = new Set<string>([trigger.id]);
  const queue = [trigger.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  const orphans = graph.nodes.filter((n) => !reached.has(n.id));
  if (orphans.length > 0) {
    throw new GraphValidationError(
      `Hay nodos sin conexión desde el disparador: ${orphans.map((n) => n.id).join(", ")}`,
    );
  }

  // Cycle detection (DFS with recursion stack) over the reachable subgraph.
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>(graph.nodes.map((n) => [n.id, WHITE]));
  function dfs(nodeId: string): boolean {
    color.set(nodeId, GRAY);
    for (const next of adjacency.get(nodeId) ?? []) {
      const c = color.get(next);
      if (c === GRAY) return true; // back edge -> cycle
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(nodeId, BLACK);
    return false;
  }
  if (dfs(trigger.id)) {
    throw new GraphValidationError("El flujo tiene un ciclo");
  }

  validateTemplateVariables(graph);

  return graph;
}

// {{contact.name}}-style placeholders in action configs must reference a
// known variable path — checked structurally at save time so a typo doesn't
// surface as a broken message at send time (PLAN.md §7.1).
const KNOWN_VARIABLE_ROOTS = ["contact", "deal", "trigger"] as const;
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function validateTemplateVariables(graph: FlowGraph): void {
  for (const node of graph.nodes) {
    if (node.kind !== "action") continue;
    for (const [key, value] of Object.entries(node.config)) {
      if (typeof value !== "string") continue;
      for (const match of value.matchAll(VARIABLE_PATTERN)) {
        const path = match[1];
        const root = path.split(".")[0];
        if (!(KNOWN_VARIABLE_ROOTS as readonly string[]).includes(root)) {
          throw new GraphValidationError(
            `Variable desconocida "{{${path}}}" en el nodo ${node.id} (${key})`,
          );
        }
      }
    }
  }
}

export function getTriggerNode(graph: FlowGraph): TriggerNode {
  const trigger = graph.nodes.find((n) => n.kind === "trigger");
  if (!trigger) throw new GraphValidationError("El flujo no tiene disparador");
  return trigger as TriggerNode;
}

export function getNode(graph: FlowGraph, nodeId: string): FlowNode | null {
  return graph.nodes.find((n) => n.id === nodeId) ?? null;
}

// Outgoing edges from a node, optionally filtered by branch handle.
export function outEdges(
  graph: FlowGraph,
  nodeId: string,
  handle?: string,
): FlowEdge[] {
  return graph.edges.filter(
    (e) => e.source === nodeId && (handle === undefined || e.sourceHandle === handle),
  );
}
