"use client";

import { useCallback, useState, useTransition } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./node-types";
import { saveDraftAction, publishVersionAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type NodeData = { kind: string; type: string; label: string; config: Record<string, unknown> };
type FlowNodeUI = Node<NodeData>;

const TRIGGER_TYPES = [
  "wa_message",
  "form_submitted",
  "deal_stage_changed",
  "contact_created",
  "tag_added",
];
const CONDITION_TYPES = [
  "contact_field",
  "contact_tag",
  "deal_stage",
  "business_hours",
  "has_responded_since",
];
const ACTION_TYPES = [
  "send_wa_message",
  "send_wa_template",
  "add_tag",
  "remove_tag",
  "move_deal_stage",
  "assign_user",
  "create_activity",
  "notify_user",
];
const DELAY_TYPES = ["wait_duration", "wait_for_reply"];

const TYPES_BY_KIND: Record<string, string[]> = {
  trigger: TRIGGER_TYPES,
  condition: CONDITION_TYPES,
  action: ACTION_TYPES,
  delay: DELAY_TYPES,
};

let nodeCounter = 0;
function nextNodeId() {
  nodeCounter += 1;
  return `n${Date.now()}_${nodeCounter}`;
}

export type ReferenceData = {
  forms: { id: string; name: string }[];
  stages: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  templates: { name: string; language: string }[];
};

function toUiNode(n: {
  id: string;
  kind: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}): FlowNodeUI {
  return {
    id: n.id,
    type: "flowNode",
    position: n.position,
    data: { kind: n.kind, type: n.type, label: n.type.replace(/_/g, " "), config: n.config },
  };
}

export function FlowEditor({
  flowId,
  initialNodes,
  initialEdges,
  latestVersionId,
  isPublished,
  reference,
}: {
  flowId: string;
  initialNodes: FlowNodeUI[];
  initialEdges: Edge[];
  latestVersionId: string | null;
  isPublished: boolean;
  reference: ReferenceData;
}) {
  const [nodes, setNodes] = useState<FlowNodeUI[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reloading the page after a save (below) remounts this component with a
  // fresh `latestVersionId` prop, so no local state is needed to track it.
  const savedVersionId = latestVersionId;
  const [published, setPublished] = useState(isPublished);
  const [pending, startTransition] = useTransition();

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNodeUI>[]) =>
      setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );
  const onConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge(conn, eds)),
    [],
  );

  function addNode(kind: string) {
    const type = TYPES_BY_KIND[kind][0];
    const id = nextNodeId();
    if (kind === "trigger" && nodes.some((n) => n.data.kind === "trigger")) {
      setError("Ya hay un disparador — un flujo solo puede tener uno.");
      return;
    }
    setNodes((nds) => [
      ...nds,
      toUiNode({
        id,
        kind,
        type,
        position: { x: 80 + nds.length * 40, y: 80 + nds.length * 60 },
        config: {},
      }),
    ]);
    setSelectedId(id);
  }

  function updateSelected(patch: Partial<NodeData>) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    );
  }

  function updateSelectedConfig(key: string, value: unknown) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
          : n,
      ),
    );
  }

  function deleteSelected() {
    if (!selectedId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }

  function toGraph() {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.data.kind,
        type: n.data.type,
        position: n.position,
        config: n.data.config,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
      })),
    };
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await saveDraftAction(flowId, toGraph());
      if (result.error) {
        setError(result.error);
        return;
      }
      setPublished(false);
      // Re-fetch the version id isn't returned directly; reload via a light
      // trick: server action revalidates the page, but we also need the new
      // version id for Publish — request it via a follow-up navigation.
      window.location.reload();
    });
  }

  function handlePublish() {
    if (!savedVersionId) return;
    setError(null);
    startTransition(async () => {
      const result = await publishVersionAction(flowId, savedVersionId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPublished(true);
    });
  }

  const selected = nodes.find((n) => n.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-4">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => addNode("trigger")}>
            + Disparador
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addNode("condition")}>
            + Condición
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addNode("action")}>
            + Acción
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addNode("delay")}>
            + Espera
          </Button>
          <div className="flex-1" />
          <Button type="button" size="sm" disabled={pending} onClick={handleSave}>
            Guardar borrador
          </Button>
          <Button
            type="button"
            size="sm"
            variant={published ? "secondary" : "default"}
            disabled={pending || !savedVersionId || published}
            onClick={handlePublish}
          >
            {published ? "Publicado" : "Publicar"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex-1 rounded-lg border">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              fitView
            >
              <Background />
              <Controls />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>

      <div className="w-72 shrink-0 overflow-y-auto rounded-lg border p-4">
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            Seleccioná un nodo para configurarlo.
          </p>
        ) : (
          <NodeConfigPanel
            node={selected}
            reference={reference}
            onTypeChange={(type) => updateSelected({ type, label: type.replace(/_/g, " ") })}
            onConfigChange={updateSelectedConfig}
            onDelete={deleteSelected}
          />
        )}
      </div>
    </div>
  );
}

function NodeConfigPanel({
  node,
  reference,
  onTypeChange,
  onConfigChange,
  onDelete,
}: {
  node: FlowNodeUI;
  reference: ReferenceData;
  onTypeChange: (type: string) => void;
  onConfigChange: (key: string, value: unknown) => void;
  onDelete: () => void;
}) {
  const { kind, type, config } = node.data;
  const c = config as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold capitalize">{kind}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
          Eliminar
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label>Tipo</Label>
        <select
          value={type}
          onChange={(e) => onTypeChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {TYPES_BY_KIND[kind].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {type === "form_submitted" && (
        <div className="grid gap-1.5">
          <Label>Formulario</Label>
          <select
            value={String(c.formId ?? "")}
            onChange={(e) => onConfigChange("formId", e.target.value || undefined)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Cualquiera</option>
            {reference.forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === "wa_message" && (
        <div className="grid gap-1.5">
          <Label>Palabra clave (opcional)</Label>
          <Input
            value={String(c.keyword ?? "")}
            onChange={(e) => onConfigChange("keyword", e.target.value || undefined)}
          />
        </div>
      )}

      {(type === "deal_stage_changed" || type === "move_deal_stage" || type === "deal_stage") && (
        <div className="grid gap-1.5">
          <Label>Etapa</Label>
          <select
            value={String(c.stageId ?? "")}
            onChange={(e) => onConfigChange("stageId", e.target.value || undefined)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">—</option>
            {reference.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {(type === "add_tag" || type === "remove_tag" || type === "contact_tag" || type === "tag_added") && (
        <div className="grid gap-1.5">
          <Label>Etiqueta</Label>
          <select
            value={String(c.tagId ?? "")}
            onChange={(e) => onConfigChange("tagId", e.target.value || undefined)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">—</option>
            {reference.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === "send_wa_message" && (
        <div className="grid gap-1.5">
          <Label>Mensaje</Label>
          <textarea
            value={String(c.body ?? "")}
            onChange={(e) => onConfigChange("body", e.target.value)}
            placeholder="Hola {{contact.name}}…"
            className="min-h-24 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
          />
        </div>
      )}

      {type === "send_wa_template" && (
        <div className="grid gap-1.5">
          <Label>Plantilla</Label>
          <select
            value={String(c.templateName ?? "")}
            onChange={(e) => {
              const tpl = reference.templates.find((t) => t.name === e.target.value);
              onConfigChange("templateName", e.target.value);
              onConfigChange("templateLanguage", tpl?.language ?? "es");
            }}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">—</option>
            {reference.templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === "wait_duration" && (
        <div className="grid gap-1.5">
          <Label>Duración (minutos)</Label>
          <Input
            type="number"
            min={1}
            value={String(c.durationMinutes ?? 60)}
            onChange={(e) => onConfigChange("durationMinutes", Number(e.target.value))}
          />
        </div>
      )}

      {type === "wait_for_reply" && (
        <div className="grid gap-1.5">
          <Label>Tiempo de espera antes del timeout (minutos)</Label>
          <Input
            type="number"
            min={1}
            value={String(c.timeoutMinutes ?? 2880)}
            onChange={(e) => onConfigChange("timeoutMinutes", Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Conectá la rama &quot;replied&quot; y &quot;timeout&quot; a los siguientes pasos.
          </p>
        </div>
      )}

      {type === "create_activity" && (
        <div className="grid gap-1.5">
          <Label>Nota</Label>
          <textarea
            value={String(c.body ?? "")}
            onChange={(e) => onConfigChange("body", e.target.value)}
            className="min-h-16 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
          />
        </div>
      )}
    </div>
  );
}
