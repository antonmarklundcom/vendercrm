import { z } from "zod";

// Flow graph shape + validation (PLAN.md §7.1). The editor stores exactly
// this JSON, and publishing re-validates it — the engine can then assume a
// well-formed graph rather than defending against one at every step.

export const TRIGGER_TYPES = [
  "wa_message_received",
  "form_submitted",
  "lead_received",
  "deal_stage_changed",
  "contact_created",
  "tag_added",
  // Booking (docs/SPEC-BOOKING.md §7). Three enum entries and an emit call —
  // the execution engine itself does not change.
  "booking_created",
  "booking_cancelled",
  "booking_no_show",
  // Website chat (docs/SPEC-CHAT-WIDGET.md §6). Only the capture, because
  // that is the moment a contact exists for a flow to act on — a trigger on
  // every visitor message would be a bill, not a feature.
  "chat_lead_captured",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

const nodeBase = { id: z.string().min(1).max(100) };

export const flowNodeSchema = z.discriminatedUnion("type", [
  z.object({
    ...nodeBase,
    type: z.literal("trigger"),
    config: z.object({ triggerType: z.enum(TRIGGER_TYPES) }).passthrough(),
  }),
  // Conditions branch two ways; the edge carries which side it is.
  z.object({
    ...nodeBase,
    type: z.literal("condition"),
    config: z
      .object({
        kind: z.enum(["has_tag", "deal_in_stage", "business_hours", "has_replied_since"]),
      })
      .passthrough(),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("action"),
    config: z
      .object({
        kind: z.enum([
          "send_whatsapp",
          "send_template",
          "add_tag",
          "remove_tag",
          "move_deal_stage",
          "assign_user",
          "create_note",
          // AI auto-reply (PLAN.md §10 1O). An action node like any other —
          // the engine change is this enum entry; the guards live in
          // modules/ai/reply.ts.
          "ai_reply",
          // GBP review request (PLAN.md §10 1R #5 / §10 1P). No Google API —
          // it sends the tenant's own review link over WhatsApp, same
          // free-form-send guards as send_whatsapp.
          "send_review_request",
          // Offer the next free slots as tappable options in the thread
          // (plan-booking.md §5.3). Free-form, so the same 24h-window guard
          // as send_whatsapp applies — this answers someone who just wrote,
          // it does not open a conversation.
          "offer_slots",
        ]),
        /**
         * Only meaningful on `ai_reply`. Absent means draft, and the tenant
         * setting is a ceiling over this either way (modules/ai/reply.ts
         * `resolveMode`), so a graph JSON edited by hand cannot make a
         * draft-mode tenant send.
         */
        mode: z.enum(["draft", "send"]).optional(),
        /** Only meaningful on `offer_slots`: which booking type to offer. */
        bookingTypeId: z.string().max(26).optional(),
      })
      .passthrough(),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("delay"),
    config: z
      .object({
        kind: z.enum(["wait_duration", "wait_for_reply"]),
        // Minutes for wait_duration; timeout in minutes for wait_for_reply.
        minutes: z.number().int().min(1).max(60 * 24 * 30),
      })
      .passthrough(),
  }),
]);

export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.string().min(1).max(100),
  target: z.string().min(1).max(100),
  /**
   * Which outlet of the source node this edge leaves from. Condition nodes
   * use yes/no; wait_for_reply uses replied/timeout; everything else uses
   * the default outlet.
   */
  branch: z.enum(["default", "yes", "no", "replied", "timeout"]).default("default"),
});

export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema).min(1),
  edges: z.array(flowEdgeSchema),
});

export type FlowGraph = z.infer<typeof flowGraphSchema>;

export type GraphValidationError = { code: string; message: string };

/**
 * Structural rules from §7.1: "single trigger, no orphan nodes, no cycles".
 * Returns every problem rather than the first, so the editor can show them
 * all at once.
 */
export function validateGraph(graph: FlowGraph): GraphValidationError[] {
  const errors: GraphValidationError[] = [];

  const triggers = graph.nodes.filter((node) => node.type === "trigger");
  if (triggers.length !== 1) {
    errors.push({
      code: "trigger_count",
      message: `El flujo necesita exactamente un disparador (tiene ${triggers.length})`,
    });
  }

  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      errors.push({ code: "duplicate_node", message: `Nodo duplicado: ${node.id}` });
    }
    ids.add(node.id);
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.source)) {
      errors.push({ code: "unknown_source", message: `Conexión desde un nodo inexistente: ${edge.source}` });
    }
    if (!ids.has(edge.target)) {
      errors.push({ code: "unknown_target", message: `Conexión hacia un nodo inexistente: ${edge.target}` });
    }
  }

  const trigger = triggers[0];
  if (trigger) {
    // Orphans: anything the trigger can't reach would never run, which is
    // almost always an editing mistake rather than an intent.
    const reachable = new Set<string>();
    const queue = [trigger.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of graph.edges) {
        if (edge.source === current) queue.push(edge.target);
      }
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        errors.push({ code: "orphan_node", message: `Nodo inalcanzable: ${node.id}` });
      }
    }

    if (hasCycle(graph)) {
      errors.push({ code: "cycle", message: "El flujo no puede tener ciclos" });
    }
  }

  return errors;
}

function hasCycle(graph: FlowGraph): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();

  function visit(id: string): boolean {
    const current = state.get(id);
    if (current === VISITING) return true;
    if (current === DONE) return false;

    state.set(id, VISITING);
    for (const next of outgoing.get(id) ?? []) {
      if (visit(next)) return true;
    }
    state.set(id, DONE);
    return false;
  }

  return graph.nodes.some((node) => visit(node.id));
}

/** Follows the edge leaving `nodeId` on the given branch, or null if none. */
export function nextNodeId(
  graph: FlowGraph,
  nodeId: string,
  branch: FlowEdge["branch"] = "default",
): string | null {
  const edge = graph.edges.find((e) => e.source === nodeId && e.branch === branch);
  return edge?.target ?? null;
}

export function findNode(graph: FlowGraph, nodeId: string): FlowNode | null {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}
