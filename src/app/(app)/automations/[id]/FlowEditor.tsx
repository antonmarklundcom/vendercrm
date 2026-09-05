"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import { CONDITION_KINDS, type FlowGraph, type TriggerType } from "@/modules/automations/graph";
import { saveDraftAction, publishFlowAction } from "../actions";
import { Input, Select, Textarea } from "@/components/ui/form-fields";

// React Flow canvas (PLAN.md §7.1). The canvas is the source of truth while
// editing; saving serialises it back into the same graph JSON the engine
// interprets, so what you see is literally what runs.

type NodeData = { label: string; kind?: string; config: Record<string, unknown> };

// Node kinds the palette offers, in display order. Labels live in
// messages/es.json (`app.automations.editor.palette`, keyed by kind) so the
// editor doesn't hardcode copy like the rest of the UI (PLAN.md §1.2).
const PALETTE: Array<{ type: "condition" | "action" | "delay"; kind: string }> = [
  { type: "action", kind: "send_whatsapp" },
  { type: "action", kind: "send_template" },
  { type: "action", kind: "add_tag" },
  { type: "action", kind: "remove_tag" },
  { type: "action", kind: "move_deal_stage" },
  { type: "action", kind: "assign_user" },
  { type: "action", kind: "create_note" },
  { type: "action", kind: "ai_reply" },
  { type: "action", kind: "send_review_request" },
  { type: "action", kind: "offer_slots" },
  { type: "action", kind: "create_task" },
  { type: "action", kind: "notify_user" },
  { type: "action", kind: "send_email" },
  { type: "condition", kind: "has_tag" },
  { type: "condition", kind: "deal_in_stage" },
  { type: "condition", kind: "business_hours" },
  { type: "condition", kind: "has_replied_since" },
  { type: "condition", kind: "deal_value" },
  { type: "condition", kind: "lead_source" },
  { type: "condition", kind: "site" },
  { type: "condition", kind: "contact_field" },
  { type: "delay", kind: "wait_duration" },
  { type: "delay", kind: "wait_for_reply" },
];

type EditorTranslator = ReturnType<typeof useTranslations<"app.automations.editor">>;

function paletteLabel(t: EditorTranslator, kind: string): string {
  return t(`palette.${kind}` as "palette.send_whatsapp");
}

export function FlowEditor({
  flowId,
  triggerType,
  initialGraph,
}: {
  flowId: string;
  triggerType: TriggerType;
  initialGraph: FlowGraph | null;
}) {
  const t = useTranslations("app.automations.editor");
  const seeded = initialGraph ?? {
    nodes: [{ id: "t1", type: "trigger" as const, config: { triggerType } }],
    edges: [],
  };

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(
    seeded.nodes.map((node, index) => ({
      id: node.id,
      position: { x: 120, y: 60 + index * 110 },
      data: {
        label: labelFor(t, node.type, (node.config as { kind?: string }).kind),
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
          label: paletteLabel(t, entry.kind),
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
      setMessage(t("draftSaved"));
    });
  }

  function publish() {
    setErrors([]);
    setMessage(null);
    startTransition(async () => {
      await saveDraftAction(flowId, JSON.stringify(serialise()));
      const result = await publishFlowAction(flowId);
      if (result.ok) setMessage(t("published"));
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
            + {paletteLabel(t, entry.kind)}
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
          {t("saveDraft")}
        </Button>
        <Button type="button" onClick={publish} disabled={pending}>
          {t("publish")}
        </Button>
        {message && <span className="text-sm text-success">{message}</span>}
      </div>

      {errors.length > 0 && (
        <ul className="rounded-md border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive">
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
  if (CONDITION_KINDS.includes(kind as (typeof CONDITION_KINDS)[number])) {
    return "condition";
  }
  return "action";
}

function labelFor(t: EditorTranslator, type: string, kind?: string): string {
  if (type === "trigger") return t("triggerNode");
  if (kind && PALETTE.some((entry) => entry.kind === kind)) return paletteLabel(t, kind);
  return kind ?? type;
}

/** Per-node fields. Deliberately plain inputs — ids are pasted from the
 * relevant CRM page rather than fetched into a picker, which keeps the
 * first version of the editor small. */
function NodeConfigPanel({
  node,
  onChange,
  onDelete,
}: {
  node: Node<NodeData>;
  onChange: (config: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("app.automations.editor");
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
          {t("fields.text")}
          <Textarea
            value={String(config.text ?? "")}
            onChange={(e) => set("text", e.target.value)}
            // The merge tag is passed as an ICU argument rather than written
            // into the message: `{{…}}` is invalid ICU syntax.
            placeholder={t("fields.textPlaceholder", { tag: "{{contact.name}}" })}
            className="px-2 py-1"
          />
        </label>
      )}

      {kind === "send_review_request" && (
        <label className="flex flex-1 flex-col gap-1">
          {t("fields.text")}
          <Textarea
            value={String(config.text ?? "")}
            onChange={(e) => set("text", e.target.value)}
            placeholder={t("fields.reviewTextPlaceholder", { tag: "{{review_link}}" })}
            className="px-2 py-1"
          />
          {/* Left blank uses a sensible Spanish default with the link —
              see modules/automations/actions.ts DEFAULT_REVIEW_REQUEST_TEXT. */}
          <span className="text-xs text-muted-foreground">{t("fields.reviewTextHint")}</span>
        </label>
      )}

      {kind === "ai_reply" && (
        <>
          <label className="flex flex-1 flex-col gap-1">
            {t("fields.instructions")}
            <Textarea
              value={String(config.instructions ?? "")}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder={t("fields.instructionsPlaceholder")}
              className="px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            {t("fields.aiMode")}
            <Select
              value={config.mode === "send" ? "send" : "draft"}
              onChange={(e) => set("mode", e.target.value)}
              className="px-2 py-1"
            >
              <option value="draft">{t("fields.aiModeDraft")}</option>
              <option value="send">{t("fields.aiModeSend")}</option>
            </Select>
          </label>
          {/* The tenant-level mode is a ceiling over this one, so picking
              "send" here does nothing until an admin also turns the tenant
              autonomous in Configuración — say so rather than let it look
              like the switch did nothing. */}
          <p className="w-full text-xs text-muted-foreground">{t("fields.aiModeHint")}</p>
        </>
      )}

      {kind === "send_template" && (
        <>
          <label className="flex flex-col gap-1">
            {t("fields.template")}
            <Input
              value={String(config.templateName ?? "")}
              onChange={(e) => set("templateName", e.target.value)}
              className="px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            {t("fields.language")}
            <Input
              value={String(config.language ?? "es")}
              onChange={(e) => set("language", e.target.value)}
              className="w-20 px-2 py-1"
            />
          </label>
        </>
      )}

      {(kind === "add_tag" || kind === "remove_tag" || kind === "has_tag") && (
        <label className="flex flex-col gap-1">
          {t("fields.tagId")}
          <Input
            value={String(config.tagId ?? "")}
            onChange={(e) => set("tagId", e.target.value)}
            className="px-2 py-1"
          />
        </label>
      )}

      {(kind === "move_deal_stage" || kind === "deal_in_stage") && (
        <label className="flex flex-col gap-1">
          {t("fields.stageId")}
          <Input
            value={String(config.stageId ?? "")}
            onChange={(e) => set("stageId", e.target.value)}
            className="px-2 py-1"
          />
        </label>
      )}

      {kind === "assign_user" && (
        <label className="flex flex-col gap-1">
          {t("fields.userId")}
          <Input
            value={String(config.userId ?? "")}
            onChange={(e) => set("userId", e.target.value)}
            className="px-2 py-1"
          />
        </label>
      )}

      {kind === "create_task" && (
        <>
          <label className="flex flex-1 flex-col gap-1">
            {t("fields.taskTitle")}
            <Input
              value={String(config.title ?? "")}
              onChange={(e) => set("title", e.target.value)}
              className="px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            {t("fields.dueInHours")}
            <Input
              type="number"
              min={0}
              value={Number(config.dueInHours ?? 24)}
              onChange={(e) => set("dueInHours", Number(e.target.value))}
              className="w-24 px-2 py-1"
            />
          </label>
        </>
      )}

      {kind === "notify_user" && (
        <>
          <label className="flex flex-1 flex-col gap-1">
            {t("fields.notifyTitle")}
            <Input
              value={String(config.title ?? "")}
              onChange={(e) => set("title", e.target.value)}
              className="px-2 py-1"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            {t("fields.notifyBody")}
            <Textarea
              value={String(config.body ?? "")}
              onChange={(e) => set("body", e.target.value)}
              className="px-2 py-1"
            />
          </label>
        </>
      )}

      {(kind === "create_task" || kind === "notify_user") && (
        <label className="flex flex-col gap-1">
          {t("fields.assignee")}
          <Select
            value={String(config.assignee ?? "deal_owner")}
            onChange={(e) => set("assignee", e.target.value)}
            className="px-2 py-1"
          >
            <option value="deal_owner">{t("fields.assigneeDealOwner")}</option>
            <option value="contact_owner">{t("fields.assigneeContactOwner")}</option>
            <option value="specific">{t("fields.assigneeSpecific")}</option>
          </Select>
        </label>
      )}

      {(kind === "create_task" || kind === "notify_user") &&
        String(config.assignee ?? "") === "specific" && (
          <label className="flex flex-col gap-1">
            {t("fields.userId")}
            <Input
              value={String(config.userId ?? "")}
              onChange={(e) => set("userId", e.target.value)}
              className="px-2 py-1"
            />
          </label>
        )}

      {kind === "send_email" && (
        <>
          <label className="flex flex-1 flex-col gap-1">
            {t("fields.subject")}
            <Input
              value={String(config.subject ?? "")}
              onChange={(e) => set("subject", e.target.value)}
              className="px-2 py-1"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            {t("fields.emailBody")}
            <Textarea
              value={String(config.body ?? "")}
              onChange={(e) => set("body", e.target.value)}
              placeholder={t("fields.textPlaceholder", { tag: "{{contact.name}}" })}
              className="px-2 py-1"
            />
          </label>
          <span className="w-full text-xs text-muted-foreground">{t("fields.emailHint")}</span>
        </>
      )}

      {kind === "offer_slots" && (
        <label className="flex flex-col gap-1">
          {t("fields.bookingTypeId")}
          <Input
            value={String(config.bookingTypeId ?? "")}
            onChange={(e) => set("bookingTypeId", e.target.value)}
            className="px-2 py-1"
          />
        </label>
      )}

      {kind === "deal_value" && (
        <>
          <label className="flex flex-col gap-1">
            {t("fields.operator")}
            <Select
              value={String(config.operator ?? "gte")}
              onChange={(e) => set("operator", e.target.value)}
              className="px-2 py-1"
            >
              <option value="gte">{t("fields.operatorGte")}</option>
              <option value="lt">{t("fields.operatorLt")}</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            {t("fields.amount")}
            <Input
              type="number"
              min={0}
              value={Number(config.amount ?? 0)}
              onChange={(e) => set("amount", Number(e.target.value))}
              className="w-32 px-2 py-1"
            />
          </label>
        </>
      )}

      {kind === "lead_source" && (
        <label className="flex flex-col gap-1">
          {t("fields.leadSource")}
          <Input
            value={String(config.value ?? "")}
            onChange={(e) => set("value", e.target.value)}
            className="px-2 py-1"
          />
        </label>
      )}

      {kind === "site" && (
        <label className="flex flex-col gap-1">
          {t("fields.siteId")}
          <Input
            value={String(config.siteId ?? "")}
            onChange={(e) => set("siteId", e.target.value)}
            className="px-2 py-1"
          />
        </label>
      )}

      {kind === "contact_field" && (
        <>
          <label className="flex flex-col gap-1">
            {t("fields.fieldKey")}
            <Input
              value={String(config.key ?? "")}
              onChange={(e) => set("key", e.target.value)}
              className="px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            {t("fields.operator")}
            <Select
              value={String(config.operator ?? "equals")}
              onChange={(e) => set("operator", e.target.value)}
              className="px-2 py-1"
            >
              <option value="equals">{t("fields.operatorEquals")}</option>
              <option value="contains">{t("fields.operatorContains")}</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            {t("fields.fieldValue")}
            <Input
              value={String(config.value ?? "")}
              onChange={(e) => set("value", e.target.value)}
              className="px-2 py-1"
            />
          </label>
        </>
      )}

      {(kind === "wait_duration" || kind === "wait_for_reply" || kind === "has_replied_since") && (
        <label className="flex flex-col gap-1">
          {t("fields.minutes")}
          <Input
            type="number"
            min={1}
            value={Number(config.minutes ?? 60)}
            onChange={(e) => set("minutes", Number(e.target.value))}
            className="w-28 px-2 py-1"
          />
        </label>
      )}

      <Button type="button" size="sm" variant="outline" onClick={onDelete}>
        {t("deleteNode")}
      </Button>
    </div>
  );
}
