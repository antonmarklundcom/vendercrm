"use client";

import { useCallback, useState, useTransition } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import type { FlowGraph, TriggerType } from "@/modules/automations/graph";
import { saveDraftAction, publishFlowAction } from "../actions";

// React Flow canvas (PLAN.md §7.1). The canvas is the source of truth while
// editing; saving serialises it back into the same graph JSON the engine
// interprets, so what you see is literally what runs.

export type EditorLabels = Record<string, string>;

export type PickerOption = { id: string; label: string };
export type EditorOptions = {
  tags: PickerOption[];
  stages: PickerOption[];
  users: PickerOption[];
  templates: PickerOption[];
};

type NodeData = { label: string; kind?: string; config: Record<string, unknown> };

const PALETTE: Array<{ type: "condition" | "action" | "delay"; kind: string; label: string }> = [
  { type: "action", kind: "send_whatsapp", label: "Enviar WhatsApp" },
  { type: "action", kind: "send_template", label: "Enviar plantilla" },
  { type: "action", kind: "add_tag", label: "Agregar etiqueta" },
  { type: "action", kind: "remove_tag", label: "Quitar etiqueta" },
  { type: "action", kind: "move_deal_stage", label: "Mover etapa" },
  { type: "action", kind: "assign_user", label: "Asignar usuario" },
  { type: "action", kind: "create_note", label: "Crear nota" },
  { type: "condition", kind: "has_tag", label: "¿Tiene etiqueta?" },
  { type: "condition", kind: "deal_in_stage", label: "¿En etapa?" },
  { type: "condition", kind: "business_hours", label: "¿Horario de atención?" },
  { type: "condition", kind: "has_replied_since", label: "¿Respondió?" },
  { type: "delay", kind: "wait_duration", label: "Esperar" },
  { type: "delay", kind: "wait_for_reply", label: "Esperar respuesta" },
];

export function FlowEditor({
  flowId,
  triggerType,
  initialGraph,
  options,
}: {
  flowId: string;
  triggerType: TriggerType;
  initialGraph: FlowGraph | null;
  options: EditorOptions;
}) {
  const seeded = initialGraph ?? {
    nodes: [{ id: "t1", type: "trigger" as const, config: { triggerType } }],
    edges: [],
  };

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(
    seeded.nodes.map((node, index) => ({
      id: node.id,
      position: { x: 120, y: 60 + index * 110 },
      data: {
        label: labelFor(node.type, (node.config as { kind?: string }).kind),
        kind: (node.config as { kind?: string }).kind,
        config: node.config as Record<string, unknown>,
      },
      type: "default",
    })),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    seeded.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.branch === "default" ? undefined : edge.branch,
      data: { branch: edge.branch },
    })),
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      // Condition and wait-for-reply nodes have two labelled outlets; every
      // other node has one. Which branch a new edge takes is decided by how
      // many already leave that node.
      const twoWay =
        source?.data.kind === "wait_for_reply" ||
        (source && seededTypeOf(source) === "condition");
      const existing = edges.filter((e) => e.source === connection.source).length;

      let branch: string = "default";
      if (twoWay) {
        const pair = source?.data.kind === "wait_for_reply" ? ["replied", "timeout"] : ["yes", "no"];
        branch = pair[existing] ?? pair[pair.length - 1];
      }

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `e${Date.now()}`,
            label: branch === "default" ? undefined : branch,
            data: { branch },
          },
          eds,
        ),
      );
    },
    [nodes, edges, setEdges],
  );

  function addNode(entry: (typeof PALETTE)[number]) {
    const id = `n${Date.now()}`;
    setNodes((nds) => [
      ...nds,
      {
        id,
        position: { x: 420, y: 60 + nds.length * 90 },
        data: {
          label: entry.label,
          kind: entry.kind,
          config:
            entry.type === "delay"
              ? { kind: entry.kind, minutes: entry.kind === "wait_for_reply" ? 2880 : 60 }
              : { kind: entry.kind },
        },
        type: "default",
      },
    ]);
  }

  function serialise(): FlowGraph {
    return {
      nodes: nodes.map((node) => {
        const type = seededTypeOf(node);
        return {
          id: node.id,
          type,
          config: node.data.config,
        } as FlowGraph["nodes"][number];
      }),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        branch: (edge.data as { branch?: string } | undefined)?.branch ?? "default",
      })) as FlowGraph["edges"],
    };
  }

  function save() {
    setErrors([]);
    setMessage(null);
    startTransition(async () => {
      await saveDraftAction(flowId, JSON.stringify(serialise()));
      setMessage("Borrador guardado");
    });
  }

  function publish() {
    setErrors([]);
    setMessage(null);
    startTransition(async () => {
      await saveDraftAction(flowId, JSON.stringify(serialise()));
      const result = await publishFlowAction(flowId);
      if (result.ok) setMessage("Flujo publicado y activo");
      else setErrors(result.errors.map((e) => e.message));
    });
  }

  const selectedNode = nodes.find((n) => n.id === selected);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {PALETTE.map((entry) => (
          <Button
            key={entry.kind}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => addNode(entry)}
          >
            + {entry.label}
          </Button>
        ))}
      </div>

      <div className="h-[460px] rounded-md border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelected(node.id)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {selectedNode && (
        <NodeConfigPanel
          options={options}
          node={selectedNode}
          onChange={(config) =>
            setNodes((nds) =>
              nds.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, config } } : n)),
            )
          }
          onDelete={() => {
            setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
            setEdges((eds) =>
              eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id),
            );
            setSelected(null);
          }}
        />
      )}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={pending} variant="outline">
          Guardar borrador
        </Button>
        <Button type="button" onClick={publish} disabled={pending}>
          Publicar
        </Button>
        {message && <span className="text-sm text-green-700">{message}</span>}
      </div>

      {errors.length > 0 && (
        <ul className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function seededTypeOf(node: Node<NodeData>): "trigger" | "condition" | "action" | "delay" {
  const kind = node.data.kind;
  if (!kind) return "trigger";
  if (["wait_duration", "wait_for_reply"].includes(kind)) return "delay";
  if (["has_tag", "deal_in_stage", "business_hours", "has_replied_since"].includes(kind)) {
    return "condition";
  }
  return "action";
}

function labelFor(type: string, kind?: string): string {
  if (type === "trigger") return "Disparador";
  return PALETTE.find((entry) => entry.kind === kind)?.label ?? kind ?? type;
}

/** Per-node fields. Deliberately plain inputs — ids are pasted from the
 * relevant CRM page rather than fetched into a picker, which keeps the
 * first version of the editor small. */
function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border px-2 py-1"
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NodeConfigPanel({
  node,
  onChange,
  onDelete,
  options,
}: {
  node: Node<NodeData>;
  onChange: (config: Record<string, unknown>) => void;
  onDelete: () => void;
  options: EditorOptions;
}) {
  const config = node.data.config;
  const kind = node.data.kind;

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border p-3 text-sm">
      <span className="font-medium">{node.data.label}</span>

      {(kind === "send_whatsapp" || kind === "create_note") && (
        <label className="flex flex-1 flex-col gap-1">
          Texto
          <textarea
            value={String(config.text ?? "")}
            onChange={(e) => set("text", e.target.value)}
            placeholder="Hola {{contact.name}}…"
            className="rounded-md border px-2 py-1"
          />
        </label>
      )}

      {kind === "send_template" && (
        <Picker
          label="Plantilla aprobada"
          value={
            config.templateName ? `${config.templateName}|${config.language ?? "es"}` : ""
          }
          options={options.templates}
          onChange={(value) => {
            // The picker carries name|language as one value because a send
            // needs both (§6.4); split it back apart on the way in.
            const separator = value.lastIndexOf("|");
            onChange({
              ...config,
              templateName: separator > 0 ? value.slice(0, separator) : "",
              language: separator > 0 ? value.slice(separator + 1) : "es",
            });
          }}
        />
      )}

      {(kind === "add_tag" || kind === "remove_tag" || kind === "has_tag") && (
        <Picker
          label="Etiqueta"
          value={String(config.tagId ?? "")}
          options={options.tags}
          onChange={(value) => set("tagId", value)}
        />
      )}

      {(kind === "move_deal_stage" || kind === "deal_in_stage") && (
        <Picker
          label="Etapa"
          value={String(config.stageId ?? "")}
          options={options.stages}
          onChange={(value) => set("stageId", value)}
        />
      )}

      {kind === "assign_user" && (
        <Picker
          label="Usuario"
          value={String(config.userId ?? "")}
          options={options.users}
          onChange={(value) => set("userId", value)}
        />
      )}

      {(kind === "wait_duration" || kind === "wait_for_reply" || kind === "has_replied_since") && (
        <label className="flex flex-col gap-1">
          Minutos
          <input
            type="number"
            min={1}
            value={Number(config.minutes ?? 60)}
            onChange={(e) => set("minutes", Number(e.target.value))}
            className="w-28 rounded-md border px-2 py-1"
          />
        </label>
      )}

      <Button type="button" size="sm" variant="outline" onClick={onDelete}>
        Eliminar nodo
      </Button>
    </div>
  );
}
