import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { listForms } from "@/modules/forms/forms";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { Button } from "@/components/ui/button";
import { createFormAction } from "./actions";

export default async function FormsPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.forms");

  const [tenant, forms, pipelines] = await Promise.all([
    getTenant(ctx.tenantId),
    listForms(ctx),
    listPipelines(ctx),
  ]);
  const pipeline = pipelines[0];
  const stages = pipeline ? await listStagesForPipeline(ctx, pipeline.id) : [];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
        <ul className="flex flex-col gap-2 text-sm">
          {forms.map((form) => (
            <li key={form.id} className="rounded-md border px-3 py-2">
              <p className="font-medium">{form.name}</p>
              <p className="text-muted-foreground">
                {tenant && `/f/${tenant.slug}/${form.slug}`}
              </p>
            </li>
          ))}
          {forms.length === 0 && <li className="text-muted-foreground">{t("empty")}</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("createTitle")}</h2>
        <form action={createFormAction} className="flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("name")}
            <input name="name" required className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("slug")}
            <input name="slug" required className="rounded-md border px-3 py-2" />
          </label>
          {pipeline && (
            <>
              <input type="hidden" name="targetPipelineId" value={pipeline.id} />
              <label className="flex flex-col gap-1 text-sm">
                {t("targetStage")}
                <select name="targetStageId" className="rounded-md border px-3 py-2">
                  <option value="">{t("noStage")}</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <Button type="submit">{t("createForm")}</Button>
        </form>
      </section>
    </div>
  );
}
