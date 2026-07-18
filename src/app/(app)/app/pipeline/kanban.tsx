"use client";

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { moveDealAction } from "../../actions";

export type KanbanStage = { id: string; name: string; color: string | null };
export type KanbanDeal = {
  id: string;
  title: string;
  stageId: string;
  value: number | null;
  currency: string;
};

function DealCard({ deal }: { deal: KanbanDeal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: deal.id });
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
      className={`cursor-grab rounded-md border bg-card p-3 text-sm shadow-xs ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="font-medium">{deal.title}</div>
      {deal.value != null && (
        <div className="text-xs text-muted-foreground">
          {deal.value.toLocaleString("es-PY")} {deal.currency}
        </div>
      )}
    </div>
  );
}

function Column({
  stage,
  deals,
}: {
  stage: KanbanStage;
  deals: KanbanDeal[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className="flex w-64 shrink-0 flex-col gap-2">
      <div className="flex items-center gap-2 px-1 text-sm font-medium">
        <span
          className="inline-block size-2 rounded-full"
          style={{ backgroundColor: stage.color ?? "#94a3b8" }}
        />
        {stage.name}
        <span className="text-muted-foreground">({deals.length})</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-col gap-2 rounded-lg border p-2 ${
          isOver ? "bg-accent" : "bg-muted/30"
        }`}
      >
        {deals.map((d) => (
          <DealCard key={d.id} deal={d} />
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard({
  stages,
  deals: initialDeals,
}: {
  stages: KanbanStage[];
  deals: KanbanDeal[];
}) {
  const [deals, setDeals] = useState(initialDeals);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id);
    const toStageId = event.over ? String(event.over.id) : null;
    if (!toStageId) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === toStageId) return;

    // Optimistic move; the server action persists + writes the timeline/event.
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stageId: toStageId } : d)),
    );
    void moveDealAction(dealId, toStageId);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <Column
            key={stage.id}
            stage={stage}
            deals={deals.filter((d) => d.stageId === stage.id)}
          />
        ))}
      </div>
    </DndContext>
  );
}
