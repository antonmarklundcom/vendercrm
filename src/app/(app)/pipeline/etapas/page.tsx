import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { listDealsForPipeline } from "@/modules/crm/deals";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  createStageAction,
  deleteStageAction,
  moveStageAction,
  updateStageAction,
} from "../actions";
import { Input, Select } from "@/components/ui/form-fields";

// Stage editor (PLAN.md §13 H8). Admin-only, like every other piece of
// tenant configuration (§3.2, H1) — the page re-checks for itself rather
// than trusting the hidden nav entry.
export default async function StagesPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; error?: string }>;
}) {
  const { pipeline: pipelineParam, error } = await searchParams;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.stages");
  const tp = await getTranslations("app.pipeline");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const pipelines = await listPipelines(ctx);
  const pipeline = pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];
  if (!pipeline) {
    return <p className="text-muted-foreground">{tp("noPipelineBody")}</p>;
  }

  const [stages, deals] = await Promise.all([
    listStagesForPipeline(ctx, pipeline.id),
    listDealsForPipeline(ctx, pipeline.id),
  ]);

  const dealsPerStage = new Map<string, number>();
  for (const deal of deals) {
    dealsPerStage.set(deal.stageId, (dealsPerStage.get(deal.stageId) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        action={
          <Link
            href={`/pipeline?pipeline=${pipeline.id}`}
            className="text-sm underline underline-offset-4"
          >
            {t("backToBoard")}
          </Link>
        }
      />

      {pipelines.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label={tp("switcherLabel")}>
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`/pipeline/etapas?pipeline=${p.id}`}
              className={`rounded-full border px-3 py-1 text-sm ${
                p.id === pipeline.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {p.name}
            </Link>
          ))}
        </nav>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}` as "errors.notEmpty")}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {stages.map((stage, index) => {
          const held = dealsPerStage.get(stage.id) ?? 0;
          return (
            <li key={stage.id} className="flex flex-col gap-2 rounded-md border p-3">
              <form action={updateStageAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="stageId" value={stage.id} />

                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("name")}
                  <Input
                    name="name"
                    defaultValue={stage.name}
                    maxLength={200}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("color")}
                  <Input
                    type="color"
                    name="color"
                    defaultValue={stage.color ?? "#71717a"}
                    className="h-8 w-16"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("outcome")}
                  <Select
                    name="outcome"
                    defaultValue={stage.isWon ? "won" : stage.isLost ? "lost" : "none"}
                  >
                    <option value="none">{t("outcomeNone")}</option>
                    <option value="won">{t("outcomeWon")}</option>
                    <option value="lost">{t("outcomeLost")}</option>
                  </Select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("staleAfterDays")}
                  <Input
                    type="number"
                    name="staleAfterDays"
                    min={1}
                    max={365}
                    className="w-24"
                    defaultValue={stage.staleAfterDays ?? ""}
                  />
                </label>

                <Button type="submit" size="sm" variant="outline">
                  {t("save")}
                </Button>
              </form>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t("dealCount", { count: held })}</span>

                <form action={moveStageAction}>
                  <input type="hidden" name="stageId" value={stage.id} />
                  <input type="hidden" name="direction" value="left" />
                  <Button type="submit" size="sm" variant="ghost" disabled={index === 0}>
                    {t("moveLeft")}
                  </Button>
                </form>

                <form action={moveStageAction}>
                  <input type="hidden" name="stageId" value={stage.id} />
                  <input type="hidden" name="direction" value="right" />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    disabled={index === stages.length - 1}
                  >
                    {t("moveRight")}
                  </Button>
                </form>

                {/* Deleting is offered only for an empty stage — the action
                    refuses either way, this just doesn't dangle the option. */}
                <form action={deleteStageAction}>
                  <input type="hidden" name="stageId" value={stage.id} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    disabled={held > 0 || stages.length <= 1}
                  >
                    {t("delete")}
                  </Button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("createTitle")}</h2>
        <form action={createStageAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="pipelineId" value={pipeline.id} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("name")}
            <Input name="name" maxLength={200} />
          </label>
          <Button type="submit" size="sm">
            {t("create")}
          </Button>
        </form>
      </section>
    </div>
  );
}
