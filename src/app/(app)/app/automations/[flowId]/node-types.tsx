"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

const KIND_STYLES: Record<string, string> = {
  trigger: "border-sky-500 bg-sky-500/10",
  condition: "border-amber-500 bg-amber-500/10",
  action: "border-emerald-500 bg-emerald-500/10",
  delay: "border-violet-500 bg-violet-500/10",
};

type NodeData = {
  kind: "trigger" | "condition" | "action" | "delay";
  type: string;
  label: string;
};

function BaseNode({ data, selected }: NodeProps & { data: NodeData }) {
  const hasTarget = data.kind !== "trigger";
  const isBranch = data.kind === "condition" || data.type === "wait_for_reply";
  const branchLabels =
    data.kind === "condition" ? ["no", "yes"] : ["timeout", "replied"];

  return (
    <div
      className={cn(
        "min-w-40 rounded-md border-2 bg-card px-3 py-2 text-xs shadow-sm",
        KIND_STYLES[data.kind],
        selected && "ring-2 ring-ring",
      )}
    >
      {hasTarget && (
        <Handle type="target" position={Position.Top} className="!bg-foreground" />
      )}
      <div className="font-semibold uppercase tracking-wide text-muted-foreground">
        {data.kind}
      </div>
      <div className="font-medium">{data.label}</div>

      {isBranch ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id={branchLabels[1]}
            style={{ left: "30%" }}
            className="!bg-emerald-600"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id={branchLabels[0]}
            style={{ left: "70%" }}
            className="!bg-red-600"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>{branchLabels[1]}</span>
            <span>{branchLabels[0]}</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-foreground" />
      )}
    </div>
  );
}

export const nodeTypes = {
  flowNode: BaseNode,
};
