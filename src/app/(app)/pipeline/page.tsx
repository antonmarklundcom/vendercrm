import Link from "next/link";
import { SquareKanban } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { listDealsForPipeline } from "@/modules/crm/deals";
import { listContacts } from "@/modules/crm/contacts";
import { PipelineBoard } from "./PipelineBoard";
import { CreateDealForm } from "./CreateDealForm";
import { createPipelineAction } from "./actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/form-fields";
import { FormDialogTrigger } from "@/components/ui/form-dialog";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; cerrados?: string }>;
}) {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.pipeline");
  const { pipeline: pipelineParam, cerrados: closedParam } = await searchParams;

  // Working the board is the agent's job; adding a pipeline is tenant config
  // and admin-only (§3.2), so the create form is admin-only too.
  const isAdmin = ctx.role === "admin";
  const pipelines = await listPipelines(ctx);
  const pipeline =
    pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];

  if (!pipeline) {
    return (
      <div className="flex flex-col gap-8">
        <EmptyState
          icon={SquareKanban}
          title={t("noPipeline")}
          description={t("noPipelineBody")}
        />
        {isAdmin && (
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("newPipelineTitle")}</h2>
            <NewPipelineForm t={t} />
          </section>
        )}
      </div>
    );
  }

  const [stages, deals, contacts] = await Promise.all([
    listStagesForPipeline(ctx, pipeline.id),
    listDealsForPipeline(ctx, pipeline.id),
    listContacts(ctx),
  ]);

  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  // Won and lost deals leave the board by default (PLAN.md §13 H8): the
  // board is what is still being worked, and a year of closed deals piling
  // up in two columns is what makes reps stop closing them properly.
  // `?cerrados=1` brings them back for the rep who wants to look.
  const showClosed = closedParam === "1";
  const boardStages = showClosed ? stages : stages.filter((s) => !s.isWon && !s.isLost);
  const boardStageIds = new Set(boardStages.map((stage) => stage.id));
  const boardDeals = deals.filter((deal) => boardStageIds.has(deal.stageId));
  const closedCount = deals.length - boardDeals.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={pipeline.name}
        description={t("intro")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {contacts.length > 0 && (
              <FormDialogTrigger
                id="nuevo-negocio"
                label={t("createDealTitle")}
                title={t("createDealTitle")}
              >
                <CreateDealForm
                  pipelineId={pipeline.id}
                  contacts={contacts.map((contact) => ({ id: contact.id, name: contact.name }))}
                  stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
                />
              </FormDialogTrigger>
            )}
            {isAdmin && (
              <FormDialogTrigger
                id="nueva-pipeline"
                label={t("newPipelineTitle")}
                title={t("newPipelineTitle")}
                variant="ghost"
              >
                <NewPipelineForm t={t} />
              </FormDialogTrigger>
            )}
            {isAdmin && (
              <Link
                href={`/pipeline/etapas?pipeline=${pipeline.id}`}
                className="text-sm underline underline-offset-4"
              >
                {t("editStages")}
              </Link>
            )}
          </div>
        }
      />

      {pipelines.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label={t("switcherLabel")}>
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`/pipeline?pipeline=${p.id}`}
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

      {(closedCount > 0 || showClosed) && (
        <p className="text-sm text-muted-foreground">
          <Link
            href={`/pipeline?pipeline=${pipeline.id}${showClosed ? "" : "&cerrados=1"}`}
            className="underline underline-offset-4"
          >
            {showClosed ? t("hideClosed") : t("showClosed", { count: closedCount })}
          </Link>
        </p>
      )}

      {boardDeals.length === 0 ? (
        <EmptyState
          icon={SquareKanban}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          actionLabel={contacts.length > 0 ? t("createDeal") : undefined}
          actionHref={contacts.length > 0 ? "#nuevo-negocio" : undefined}
        />
      ) : (
        <PipelineBoard
          stages={boardStages}
          deals={boardDeals.map((deal) => ({
            ...deal,
            contactName: contactsById.get(deal.contactId)?.name ?? deal.contactId,
          }))}
        />
      )}

      {/* A deal hangs off a contact (§5), so the create action is offered
          only once one exists — say so instead of a header button that
          opens a form with nothing to pick. */}
      {contacts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("needContact")}{" "}
          <Link href="/contacts" className="underline underline-offset-4">
            {t("goToContacts")}
          </Link>
        </p>
      )}
    </div>
  );
}

function NewPipelineForm({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <form action={createPipelineAction} className="flex max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {t("newPipelineName")}
        <Input name="name" required placeholder={t("newPipelineNamePlaceholder")} />
      </label>
      <Button type="submit" variant="outline" className="w-fit">
        {t("newPipelineCreate")}
      </Button>
    </form>
  );
}
