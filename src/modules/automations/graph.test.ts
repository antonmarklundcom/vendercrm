import { describe, expect, it } from "vitest";
import { validateFlowGraph, GraphValidationError, outEdges } from "./graph";

function trigger(id = "t1") {
  return {
    id,
    kind: "trigger" as const,
    type: "form_submitted" as const,
    position: { x: 0, y: 0 },
    config: { formId: "f1" },
  };
}

function action(id: string, config: Record<string, unknown> = {}) {
  return {
    id,
    kind: "action" as const,
    type: "send_wa_message" as const,
    position: { x: 0, y: 0 },
    config,
  };
}

function condition(id: string) {
  return {
    id,
    kind: "condition" as const,
    type: "contact_field" as const,
    position: { x: 0, y: 0 },
    config: {},
  };
}

describe("validateFlowGraph", () => {
  it("accepts a simple linear flow", () => {
    const graph = validateFlowGraph({
      nodes: [trigger(), action("a1", { body: "Hola {{contact.name}}" })],
      edges: [{ id: "e1", source: "t1", target: "a1" }],
    });
    expect(graph.nodes.length).toBe(2);
  });

  it("rejects zero triggers", () => {
    expect(() =>
      validateFlowGraph({ nodes: [action("a1")], edges: [] }),
    ).toThrow(GraphValidationError);
  });

  it("rejects two triggers", () => {
    expect(() =>
      validateFlowGraph({
        nodes: [trigger("t1"), trigger("t2")],
        edges: [],
      }),
    ).toThrow(GraphValidationError);
  });

  it("rejects an orphan node not reachable from the trigger", () => {
    expect(() =>
      validateFlowGraph({
        nodes: [trigger(), action("a1"), action("orphan")],
        edges: [{ id: "e1", source: "t1", target: "a1" }],
      }),
    ).toThrow(/sin conexión/);
  });

  it("rejects a cycle", () => {
    expect(() =>
      validateFlowGraph({
        nodes: [trigger(), action("a1"), action("a2")],
        edges: [
          { id: "e1", source: "t1", target: "a1" },
          { id: "e2", source: "a1", target: "a2" },
          { id: "e3", source: "a2", target: "a1" },
        ],
      }),
    ).toThrow(/ciclo/);
  });

  it("rejects an edge pointing at a nonexistent node", () => {
    expect(() =>
      validateFlowGraph({
        nodes: [trigger()],
        edges: [{ id: "e1", source: "t1", target: "ghost" }],
      }),
    ).toThrow(GraphValidationError);
  });

  it("rejects an unknown template variable", () => {
    expect(() =>
      validateFlowGraph({
        nodes: [trigger(), action("a1", { body: "{{nope.field}}" })],
        edges: [{ id: "e1", source: "t1", target: "a1" }],
      }),
    ).toThrow(/Variable desconocida/);
  });

  it("accepts a two-branch condition with distinct handles", () => {
    const graph = validateFlowGraph({
      nodes: [trigger(), condition("c1"), action("yes"), action("no")],
      edges: [
        { id: "e1", source: "t1", target: "c1" },
        { id: "e2", source: "c1", target: "yes", sourceHandle: "yes" },
        { id: "e3", source: "c1", target: "no", sourceHandle: "no" },
      ],
    });
    expect(outEdges(graph, "c1", "yes")[0].target).toBe("yes");
    expect(outEdges(graph, "c1", "no")[0].target).toBe("no");
  });
});
