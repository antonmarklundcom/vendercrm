import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listSites } from "@/modules/sites/sites";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { listAccountsForTenant } from "@/modules/whatsapp/accounts";
import { getLeadStats } from "@/modules/leads/stats";
import { env } from "@/lib/config/env";
import { Button } from "@/components/ui/button";
import { NewSiteForm, RotateKeyButton, type KeyLabels } from "./SiteKeyForms";
import { toggleSiteActiveAction, updateSiteRoutingAction } from "./actions";

export default async function SitesPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.sites");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const [sites, pipelines, waAccounts, stats] = await Promise.all([
    listSites(ctx),
    listPipelines(ctx),
    listAccountsForTenant(ctx),
    getLeadStats(ctx),
  ]);

  // Stages across every pipeline — each site normally routes into its own
  // pipeline (dentista vs materiales are different businesses), so the
  // picker has to span them rather than assume one.
  const stageOptions = (
    await Promise.all(
      pipelines.map(async (pipeline) => {
        const stages = await listStagesForPipeline(ctx, pipeline.id);
        return stages.map((stage) => ({
          id: stage.id,
          label: `${pipeline.name} › ${stage.name}`,
        }));
      }),
    )
  ).flat();

  const labels: KeyLabels = {
    copyNow: t("copyNow"),
    name: t("name"),
    slug: t("slug"),
    domain: t("domain"),
    pipeline: t("pipeline"),
    stage: t("stage"),
    waAccount: t("waAccount"),
    none: t("none"),
    create: t("createSite"),
    rotate: t("rotateKey"),
  };

  const leadsBySite = new Map(stats.bySite.map((bucket) => [bucket.key, bucket.count]));

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-2 text-xl font-semibold">{t("title")}</h1>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>

        <div className="mb-4 flex gap-6 text-sm">
          <span>
            <strong>{stats.total}</strong> {t("totalLeads")}
          </span>
          <span>
            <strong>{stats.withDeal}</strong> {t("leadsWithDeal")}
          </span>
        </div>

        <ul className="flex flex-col gap-4">
          {sites.map((site) => (
            <li key={site.id} className="flex flex-col gap-3 rounded-md border px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">
                    {site.name}{" "}
                    <span className="text-sm text-muted-foreground">{site.domain}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {site.isActive ? t("active") : t("inactive")} ·{" "}
                    <code className="font-mono text-xs">{site.apiKeyPrefix}…</code> ·{" "}
                    {leadsBySite.get(site.id) ?? 0} {t("leads")}
                  </p>
                </div>
                <form action={toggleSiteActiveAction}>
                  <input type="hidden" name="siteId" value={site.id} />
                  <input type="hidden" name="isActive" value={site.isActive ? "false" : "true"} />
                  <Button type="submit" size="sm" variant="outline">
                    {site.isActive ? t("deactivate") : t("activate")}
                  </Button>
                </form>
              </div>

              <form action={updateSiteRoutingAction} className="flex flex-wrap items-end gap-2 text-sm">
                <input type="hidden" name="siteId" value={site.id} />
                <label className="flex flex-col gap-1">
                  {t("stage")}
                  <select
                    name="defaultStageId"
                    defaultValue={site.defaultStageId ?? ""}
                    className="rounded-md border px-2 py-1"
                  >
                    <option value="">{t("none")}</option>
                    {stageOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  {t("waAccount")}
                  <select
                    name="waAccountId"
                    defaultValue={site.waAccountId ?? ""}
                    className="rounded-md border px-2 py-1"
                  >
                    <option value="">{t("none")}</option>
                    {waAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayNumber || account.phoneNumberId}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" size="sm" variant="outline">
                  {t("saveRouting")}
                </Button>
              </form>

              <RotateKeyButton siteId={site.id} labels={labels} />
            </li>
          ))}
          {sites.length === 0 && <li className="text-muted-foreground">{t("empty")}</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("createTitle")}</h2>
        <NewSiteForm
          labels={labels}
          pipelines={pipelines.map((p) => ({ id: p.id, label: p.name }))}
          stages={stageOptions}
          waAccounts={waAccounts.map((a) => ({
            id: a.id,
            label: a.displayNumber || a.phoneNumberId,
          }))}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t("howToTitle")}</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t("howToIntro")}</p>
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
          <code>{`// The site's own server (never the browser — keeps the key private)
await fetch("${env.APP_URL}/api/v1/leads", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Api-Key": process.env.VENDERCRM_API_KEY,
  },
  body: JSON.stringify({
    phone: form.phone,            // required
    name: form.name,
    email: form.email,
    message: form.message,
    page_url: pageUrl,
    referrer: referrer,
    utm_source: utm.source,       // from the first-touch cookie
    utm_campaign: utm.campaign,
    idempotency_key: submissionId, // retry-safe: same key = same lead
  }),
});`}</code>
        </pre>
      </section>

      {stats.byCampaign.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t("byCampaign")}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {stats.byCampaign.map((bucket) => (
              <li key={bucket.key} className="flex justify-between rounded-md border px-3 py-2">
                <span>{bucket.key}</span>
                <strong>{bucket.count}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
