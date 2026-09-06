"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { formatMoney } from "@/lib/i18n/format";
import { daysInStage, isStale } from "@/modules/crm/stale";
import { moveDealAction } from "./actions";

type Stage = { id: string; name: string; color: string | null; staleAfterDays: number | null };
type Deal = {
  id: string;
  stageId: string;
  title: string;
  value: number;
  currency: string;
  position: number;
  stageEnteredAt: string;
  contactName: string;
};

// Cross-column and in-column kanban DnD (PLAN.md §15.8 P5) — real position
// tracking, not just "append to the end of the target stage" (the pre-P5
// board's own comment said as much).
export function PipelineBoard({ stages, deals }: { stages: Stage[]; deals: Deal[] }) {
  const [columns, setColumns] = useState<Record<string, Deal[]>>(() => groupByStage(stages, deals));
  const [, startTransition] = useTransition();
  const t = useTranslations("app.pipeline");
  const locale = useLocale();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const dealToStage = useMemo(() => {
    const map = new Map<string, string>();
    for (const [stageId, list] of Object.entries(columns)) {
      for (const deal of list) map.set(deal.id, stageId);
    }
    return map;
  }, [columns]);

  function handleDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id);
    if (!event.over) return;
    const overId = String(event.over.id);

    const fromStageId = dealToStage.get(dealId);
    if (!fromStageId) return;

    // Dropped on a column's empty area (over.id is a stage) vs. on/near
    // another card (over.id is a deal, whose column and index we adopt).
    const toStageId = stages.some((s) => s.id === overId) ? overId : dealToStage.get(overId);
    if (!toStageId) return;

    const deal = columns[fromStageId].find((d) => d.id === dealId);
    if (!deal) return;

    const previous = columns;
    const targetList = columns[toStageId].filter((d) => d.id !== dealId);
    const overIndex = targetList.findIndex((d) => d.id === overId);
    const toPosition = overIndex >= 0 ? overIndex : targetList.length;
    targetList.splice(toPosition, 0, { ...deal, stageId: toStageId });

    if (fromStageId === toStageId) {
      setColumns((prev) => ({ ...prev, [toStageId]: targetList }));
    } else {
      setColumns((prev) => ({
        ...prev,
        [fromStageId]: prev[fromStageId].filter((d) => d.id !== dealId),
        [toStageId]: targetList,
      }));
    }

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
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto">
        {stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            deals={columns[stage.id] ?? []}
            locale={locale}
            t={t}
          />
        ))}
      </div>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
  locale,
  t,
}: {
  stage: Stage;
  deals: Deal[];
  locale: string;
  t: ReturnType<typeof useTranslations<"app.pipeline">>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  // Recomputed from live column state, not a server-fetched total, so a
  // drag-and-drop move updates both columns' totals immediately rather than
  // waiting for the next full page load. modules/crm/deals.ts's
  // `totalsByStage` is the same arithmetic, integration-tested there against
  // real rows.
  const total = deals.reduce((sum, deal) => sum + deal.value, 0);
  const currency = deals[0]?.currency ?? "PYG";

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[85vw] max-w-xs shrink-0 flex-col gap-2 rounded-md border p-2 sm:w-64 ${
        isOver ? "bg-accent" : ""
      }`}
    >
      <div className="px-1">
        <h3 className="text-sm font-semibold">
          {stage.name} <span className="text-muted-foreground">({deals.length})</span>
        </h3>
        {deals.length > 0 && (
          <p className="text-xs text-muted-foreground">{formatMoney(total, currency, locale)}</p>
        )}
      </div>
      <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} staleAfterDays={stage.staleAfterDays} t={t} />
        ))}
      </SortableContext>
    </div>
  );
}

function DealCard({
  deal,
  staleAfterDays,
  t,
}: {
  deal: Deal;
  staleAfterDays: number | null;
  t: ReturnType<typeof useTranslations<"app.pipeline">>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
  });
  const enteredAt = new Date(deal.stageEnteredAt);
  const days = daysInStage(enteredAt);
  const stale = isStale(enteredAt, staleAfterDays);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
      // touch-none keeps the browser from claiming the gesture as a scroll
      // once the press-and-hold has started the drag.
      className={`touch-none cursor-grab rounded-md border p-2 text-sm shadow-sm ${
        stale ? "border-warning/50 bg-warning-surface" : "bg-background"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      {/* The card is draggable, so the title is the link — a whole-card
          link would swallow the drag gesture. */}
      <Link href={`/pipeline/${deal.id}`} className="font-medium underline-offset-4 hover:underline">
        {deal.title}
      </Link>
      <p className="text-muted-foreground">{deal.contactName}</p>
      <p className="text-muted-foreground">
        {deal.value} {deal.currency}
      </p>
      <p className={`text-xs ${stale ? "font-medium text-warning" : "text-muted-foreground"}`}>
        {t("daysInStage", { count: days })}
        {stale ? ` · ${t("stale")}` : ""}
      </p>
    </div>
  );
}

function groupByStage(stages: Stage[], deals: Deal[]): Record<string, Deal[]> {
  const grouped: Record<string, Deal[]> = {};
  for (const stage of stages) grouped[stage.id] = [];
  for (const deal of [...deals].sort((a, b) => a.position - b.position)) {
    (grouped[deal.stageId] ??= []).push(deal);
  }
  return grouped;
}
