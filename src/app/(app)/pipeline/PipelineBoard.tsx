"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { moveDealAction } from "./actions";
import { formatNumber } from "@/lib/i18n/format";
import { Avatar } from "@/components/ui/avatar";

type Stage = { id: string; name: string; color: string | null };
type Deal = {
  id: string;
  stageId: string;
  title: string;
  value: number;
  currency: string;
  contactName: string;
};

// Cross-column kanban DnD (PLAN.md §5). Deliberately simplified for this
// pass: dropping onto a column appends the deal to the end of that stage —
// precise in-column reorder (drop position within a stage) is not wired
// yet, just the stage-to-stage move the exit criteria call for.
export function PipelineBoard({ stages, deals }: { stages: Stage[]; deals: Deal[] }) {
  const [columns, setColumns] = useState<Record<string, Deal[]>>(() =>
    groupByStage(stages, deals),
  );
  const [, startTransition] = useTransition();
  const t = useTranslations("app.pipeline");

  // Without a TouchSensor the board is mouse-only, and the board is the
  // screen a rep works from a phone (PLAN.md §13 H7). The 250ms/8px
  // press-and-hold is what separates "drag a card" from "scroll the
  // column" on a touch screen — a shorter delay makes the list unscrollable.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id);
    const toStageId = event.over ? String(event.over.id) : null;
    if (!toStageId) return;

    const fromStageId = Object.keys(columns).find((stageId) =>
      columns[stageId].some((d) => d.id === dealId),
    );
    if (!fromStageId || fromStageId === toStageId) return;

    const deal = columns[fromStageId].find((d) => d.id === dealId);
    if (!deal) return;

    const toPosition = columns[toStageId].length;
    const previous = columns;

    setColumns((prev) => ({
      ...prev,
      [fromStageId]: prev[fromStageId].filter((d) => d.id !== dealId),
      [toStageId]: [...prev[toStageId], { ...deal, stageId: toStageId }],
    }));

    // The optimistic move above is a lie until the server confirms it. A
    // rejected move used to leave the card sitting in the new column with
    // nothing persisted; now the board snaps back and says so.
    startTransition(async () => {
      try {
        await moveDealAction({ dealId, toStageId, toPosition });
      } catch {
        setColumns(previous);
        toast.error(t("moveFailed"));
      }
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto">
        {stages.map((stage) => (
          <StageColumn key={stage.id} stage={stage} deals={columns[stage.id] ?? []} />
        ))}
      </div>
    </DndContext>
  );
}

function StageColumn({ stage, deals }: { stage: Stage; deals: Deal[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[85vw] max-w-xs shrink-0 flex-col gap-2 rounded-md border p-2 sm:w-64 ${
        isOver ? "bg-accent" : ""
      }`}
    >
      <h3 className="px-1 text-sm font-semibold">
        {stage.name} <span className="text-muted-foreground">({deals.length})</span>
      </h3>
      {deals.map((deal) => (
        <DealCard key={deal.id} deal={deal} />
      ))}
    </div>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
  });
  const locale = useLocale();

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      // touch-none keeps the browser from claiming the gesture as a scroll
      // once the press-and-hold has started the drag.
      className={`touch-none cursor-grab rounded-md border border-l-2 border-l-primary bg-card p-2.5 text-sm shadow-xs ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      {/* The card is draggable, so the title is the link — a whole-card
          link would swallow the drag gesture. */}
      <Link href={`/pipeline/${deal.id}`} className="font-medium underline-offset-4 hover:underline">
        {deal.title}
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Avatar name={deal.contactName} size="xs" />
          <span className="truncate">{deal.contactName}</span>
        </span>
        <span className="shrink-0 font-medium tabular-nums">
          {formatNumber(deal.value, locale)} {deal.currency}
        </span>
      </div>
    </div>
  );
}

function groupByStage(stages: Stage[], deals: Deal[]): Record<string, Deal[]> {
  const grouped: Record<string, Deal[]> = {};
  for (const stage of stages) grouped[stage.id] = [];
  for (const deal of deals) {
    (grouped[deal.stageId] ??= []).push(deal);
  }
  return grouped;
}
