"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { moveDeal } from "@/modules/crm/pipeline-actions";

type Deal = {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  contactName: string;
  contactPhone: string;
};

type Column = {
  stage: { id: string; name: string; color: string };
  deals: Deal[];
};

function DealCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab rounded-md border border-border bg-background p-3 text-sm shadow-sm ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <p className="font-medium">{deal.title}</p>
      <p className="text-muted-foreground">{deal.contactName}</p>
      {deal.value != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          {deal.value.toLocaleString()} {deal.currency}
        </p>
      )}
    </div>
  );
}

function StageColumn({ column }: { column: Column }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border p-3 ${
        isOver ? "bg-accent" : "bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: column.stage.color }}
        />
        <h3 className="text-sm font-medium">{column.stage.name}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{column.deals.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {column.deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard({ initialColumns }: { initialColumns: Column[] }) {
  const [columns, setColumns] = useState(initialColumns);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const dealId = String(active.id);
    const toStageId = String(over.id);

    setColumns((prev) => {
      let moved: Deal | undefined;
      const withoutDeal = prev.map((col) => {
        const found = col.deals.find((d) => d.id === dealId);
        if (found) moved = found;
        return { ...col, deals: col.deals.filter((d) => d.id !== dealId) };
      });

      if (!moved) return prev;

      return withoutDeal.map((col) =>
        col.stage.id === toStageId ? { ...col, deals: [...col.deals, moved!] } : col,
      );
    });

    startTransition(() => {
      moveDeal(dealId, toStageId);
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <StageColumn key={col.stage.id} column={col} />
        ))}
      </div>
    </DndContext>
  );
}
