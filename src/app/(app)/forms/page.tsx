import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { listForms, type FormSettings } from "@/modules/forms/forms";
import { listSites } from "@/modules/sites/sites";
import { siteSettings } from "@/modules/sites/settings";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { FormCreateForm } from "./FormCreateForm";
import { updateFormTurnstileAction } from "./actions";
import { Select } from "@/components/ui/form-fields";

export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.forms");

  // A form defines a public endpoint on the tenant's slug, so it is admin
  // configuration (§3.2) — matching the guard on this page's actions.
  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const { pipeline: pipelineParam } = await searchParams;

  const [tenant, forms, pipelines, sites] = await Promise.all([
    getTenant(ctx.tenantId),
    listForms(ctx),
    listPipelines(ctx),
    listSites(ctx),
  ]);

  // Only sites that actually have Turnstile credentials saved can lend them
  // to a hosted form (PLAN.md §5.2) — offering the rest would just produce a
  // form that silently never challenges.
  const turnstileSites = sites
    .filter((site) => !!siteSettings(site).turnstile)
    .map((site) => ({ id: site.id, name: site.name }));
  const pipeline = pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];
  const stages = pipeline ? await listStagesForPipeline(ctx, pipeline.id) : [];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <PageHeader title={t("title")} description={t("intro")} />

        {forms.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            actionLabel={t("createForm")}
            actionHref="#nuevo-formulario"
          />
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {forms.map((form) => (
              <li key={form.id} className="flex flex-col gap-2 rounded-md border px-3 py-2">
                <p className="font-medium">{form.name}</p>
                <p className="text-muted-foreground">
                  {tenant && `/f/${tenant.slug}/${form.slug}`}
                </p>
                <Link href={`/forms/${form.id}`} className="w-fit text-sm underline">
                  {t("editFields")}
                </Link>
                {turnstileSites.length > 0 && (
                  <form
                    action={updateFormTurnstileAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="formId" value={form.id} />
                    <label className="flex flex-col gap-1">
                      {t("turnstileSite")}
                      <Select
                        name="turnstileSiteId"
                        defaultValue={(form.settings as FormSettings).turnstileSiteId ?? ""}
                        className="px-2 py-1"
                      >
                        <option value="">{t("turnstileNone")}</option>
                        {turnstileSites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <Button type="submit" size="sm" variant="outline">
                      {t("turnstileSave")}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="nuevo-formulario" className="scroll-mt-6">
        <h2 className="mb-4 text-lg font-semibold">{t("createTitle")}</h2>

        {pipelines.length > 1 && pipeline && (
          <form method="get" className="mb-4 flex items-end gap-2 text-sm">
            <label className="flex flex-col gap-1">
              {t("targetPipeline")}
              <Select
                name="pipeline"
                defaultValue={pipeline.id}
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="outline">
              {t("targetPipelineApply")}
            </Button>
          </form>
        )}

        <FormCreateForm
          pipelineId={pipeline?.id ?? null}
          stages={stages}
          turnstileSites={turnstileSites}
        />
      </section>
    </div>
  );
}
