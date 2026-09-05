import { notFound } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getFlow } from "@/modules/automations/flows";
import { getRun, listStepsForRun } from "@/modules/automations/engine";
import { formatDateTime } from "@/lib/i18n/format";
import { PageHeader } from "@/components/page-header";

// The step log of one run (PLAN.md §15.5 J1). This is the page that answers
// "why did my customer get that message?" — and, just as often, "why didn't
// they?", which is why a skipped step shows its reason rather than being
// hidden as a non-event.

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.automations");
  const locale = await getLocale();

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const flow = await getFlow(ctx, id);
  const run = await getRun(ctx, runId);
  // Both reads are tenant-scoped, and the run must belong to this flow —
  // otherwise a run id from another flow would render under its header.
  if (!flow || !run || run.flowId !== flow.id) notFound();

  const steps = await listStepsForRun(ctx, run.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("runDetailTitle")} description={flow.name} />

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{t("runStatus")}</dt>
          <dd>{t(`runStatusValues.${run.status}` as "runStatusValues.running")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("startedAt")}</dt>
          <dd>{formatDateTime(run.createdAt, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("currentNode")}</dt>
          <dd>{run.currentNodeId ?? "—"}</dd>
        </div>
      </dl>

      {run.lastError && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive">
          {run.lastError}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("stepsTitle")}</h2>
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSteps")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2">{t("stepWhen")}</th>
                  <th className="py-2">{t("stepNode")}</th>
                  <th className="py-2">{t("stepStatus")}</th>
                  <th className="py-2">{t("stepDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.id} className="border-b align-top">
                    <td className="py-2 whitespace-nowrap">
                      {formatDateTime(step.executedAt, locale)}
                    </td>
                    <td className="py-2">
                      {step.nodeId}
                      <span className="ml-2 text-xs text-muted-foreground">{step.nodeType}</span>
                    </td>
                    <td className="py-2">
                      {t(`stepStatusValues.${step.status}` as "stepStatusValues.ok")}
                    </td>
                    {/* The raw result JSON, on purpose: it carries the skip
                        reason, the message id and the error text, and a
                        paraphrase of it would be worth less to the person
                        debugging a flow. */}
                    <td className="py-2">
                      <code className="text-xs break-all text-muted-foreground">
                        {JSON.stringify(step.result)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div>
        <Link href={`/automations/${flow.id}`} className="text-sm underline">
          {t("backToFlow")}
        </Link>
      </div>
    </div>
  );
}
