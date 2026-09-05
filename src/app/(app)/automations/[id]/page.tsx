import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getFlow, getDraftVersion, getVersion } from "@/modules/automations/flows";
import { listRunsForFlow } from "@/modules/automations/engine";
import { flowGraphSchema, type FlowGraph, type TriggerType } from "@/modules/automations/graph";
import { Button } from "@/components/ui/button";
import { FlowEditor } from "./FlowEditor";
import { FlowNodeList } from "./FlowNodeList";
import { setFlowStatusAction, cancelRunAction } from "../actions";
import { formatDateTime } from "@/lib/i18n/format";
import { getLocale } from "next-intl/server";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.automations");
  const locale = await getLocale();

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const flow = await getFlow(ctx, id);
  if (!flow) notFound();

  // Edit the draft if there is one, otherwise start from the published
  // version — never edit a published version in place (§7.1).
  const draft = await getDraftVersion(ctx, flow.id);
  const published = flow.publishedVersionId ? await getVersion(ctx, flow.publishedVersionId) : null;
  const source = draft ?? published;

  const parsed = source ? flowGraphSchema.safeParse(source.graph) : null;
  const graph: FlowGraph | null = parsed?.success ? parsed.data : null;

  const runs = await listRunsForFlow(ctx, flow.id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{flow.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t(`triggers.${flow.triggerType}` as "triggers.form_submitted")} ·{" "}
            {t(`statusValues.${flow.status}` as "statusValues.draft")}
          </p>
        </div>
        <form action={setFlowStatusAction}>
          <input type="hidden" name="flowId" value={flow.id} />
          <input type="hidden" name="status" value={flow.status === "active" ? "paused" : "active"} />
          <Button type="submit" size="sm" variant="outline">
            {flow.status === "active" ? t("pause") : t("activate")}
          </Button>
        </form>
      </header>

      {/* The canvas needs a pointer and room; a phone gets the read-only
          list instead (PLAN.md §13 H7). */}
      <FlowNodeList graph={graph} triggerType={flow.triggerType as TriggerType} />

      <div className="hidden md:block">
        <FlowEditor
          flowId={flow.id}
          triggerType={flow.triggerType as TriggerType}
          initialGraph={graph}
        />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("runsTitle")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2">{t("runStatus")}</th>
                <th className="py-2">{t("currentNode")}</th>
                <th className="py-2">{t("startedAt")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b">
                  <td className="py-2">
                    {t(`runStatusValues.${run.status}` as "runStatusValues.running")}
                    {run.lastError && (
                      <span className="ml-2 text-xs text-destructive">{run.lastError}</span>
                    )}
                  </td>
                  <td className="py-2">{run.currentNodeId ?? "—"}</td>
                  <td className="py-2">
                    {/* The date is the link, because "what happened in this
                        run" is the question a row in this table raises. */}
                    <Link
                      href={`/automations/${flow.id}/runs/${run.id}`}
                      className="underline"
                    >
                      {formatDateTime(run.createdAt, locale)}
                    </Link>
                  </td>
                  <td className="py-2 text-right">
                    {(run.status === "running" || run.status === "waiting") && (
                      <form action={cancelRunAction}>
                        <input type="hidden" name="runId" value={run.id} />
                        <input type="hidden" name="flowId" value={flow.id} />
                        <Button type="submit" size="sm" variant="outline">
                          {t("cancelRun")}
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted-foreground">
                    {t("noRuns")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
