import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getFlow, getDraftVersion, getVersion } from "@/modules/automations/flows";
import { listRunsForFlow, listRunSteps } from "@/modules/automations/engine";
import { flowGraphSchema, type FlowGraph, type TriggerType } from "@/modules/automations/graph";
import { listTags } from "@/modules/crm/contacts";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { listTenantUsers } from "@/modules/tenancy/users";
import { listAccountsForTenant } from "@/modules/whatsapp/accounts";
import { listApprovedTemplates } from "@/modules/whatsapp/templates";
import { Button } from "@/components/ui/button";
import { FlowEditor } from "./FlowEditor";
import { setFlowStatusAction, cancelRunAction } from "../actions";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.automations");

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
  // Step history for the most recent runs only — the full table would be
  // unbounded, and older runs are rarely what you're debugging.
  const stepsByRun = new Map(
    await Promise.all(
      runs.slice(0, 10).map(async (run) => [run.id, await listRunSteps(ctx, run.id)] as const),
    ),
  );

  // Options for the node config panel. Pasting raw ULIDs was the last rough
  // edge in the editor — every id the palette needs is pickable now.
  const [tags, pipelines, users, waAccounts] = await Promise.all([
    listTags(ctx),
    listPipelines(ctx),
    listTenantUsers(ctx),
    listAccountsForTenant(ctx),
  ]);
  const stageOptions = (
    await Promise.all(
      pipelines.map(async (pipeline) =>
        (await listStagesForPipeline(ctx, pipeline.id)).map((stage) => ({
          id: stage.id,
          label: `${pipeline.name} › ${stage.name}`,
        })),
      ),
    )
  ).flat();
  const templates = waAccounts[0]
    ? (await listApprovedTemplates(ctx, waAccounts[0].id)).map((tpl) => ({
        id: `${tpl.name}|${tpl.language}`,
        label: `${tpl.name} (${tpl.language})`,
      }))
    : [];

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

      <FlowEditor
        flowId={flow.id}
        triggerType={flow.triggerType as TriggerType}
        initialGraph={graph}
        options={{
          tags: tags.map((tag) => ({ id: tag.id, label: tag.name })),
          stages: stageOptions,
          users: users.map((user) => ({ id: user.id, label: user.name })),
          templates,
        }}
      />

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("runsTitle")}</h2>
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
                    <span className="ml-2 text-xs text-red-600">{run.lastError}</span>
                  )}
                </td>
                <td className="py-2">{run.currentNodeId ?? "—"}</td>
                <td className="py-2">
                  {run.createdAt.toLocaleString("es-PY")}
                  {(stepsByRun.get(run.id)?.length ?? 0) > 0 && (
                    <ol className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                      {stepsByRun.get(run.id)!.map((step) => (
                        <li key={step.id}>
                          {step.nodeType}:{step.nodeId} — {step.status}
                        </li>
                      ))}
                    </ol>
                  )}
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
      </section>
    </div>
  );
}
