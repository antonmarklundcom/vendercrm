import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getDefaultPipeline, listStages } from "@/modules/crm/pipelines";
import { listDealsByPipeline } from "@/modules/crm/deals";
import { KanbanBoard } from "./kanban";

export default async function PipelinePage() {
  const t = await getTranslations("app");
  const ctx = await requireTenantContext();
  const pipeline = await getDefaultPipeline(ctx);

  if (!pipeline) {
    return <p className="text-muted-foreground">—</p>;
  }

  const [stages, deals] = await Promise.all([
    listStages(ctx, pipeline.id),
    listDealsByPipeline(ctx, pipeline.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{pipeline.name}</h1>
      {deals.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noDeals")}</p>
      )}
      <KanbanBoard
        stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
        deals={deals.map((d) => ({
          id: d.id,
          title: d.title,
          stageId: d.stageId,
          value: d.value,
          currency: d.currency,
        }))}
      />
    </div>
  );
}
