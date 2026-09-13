import { Globe } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/i18n/format";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { listSites } from "@/modules/sites/sites";
import { listApiKeys, MAX_ACTIVE_KEYS_PER_SITE } from "@/modules/sites/keys";
import { siteSettings, siteTurnstileSiteKey } from "@/modules/sites/settings";
import { listHookCaptures, captureLeafPaths, siteHookMapping } from "@/modules/sites/hooks";
import { ingestReasonKey, listSiteHealth, siteHealthStatus } from "@/modules/sites/health";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { listAccountsForTenant } from "@/modules/whatsapp/accounts";
import { getLeadStats } from "@/modules/leads/stats";
import { env } from "@/lib/config/env";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SiteGuide, type GuideLabels } from "./SiteGuide";
import { NewSiteForm, SiteKeysPanel, type ApiKeyRow, type KeyLabels } from "./SiteKeyForms";
import { SiteTurnstileForm } from "./SiteTurnstileForm";
import { SiteHookForm, type HookPanelProps } from "./SiteHookForm";
import { SiteHookGuide, type HookGuideLabels } from "./SiteHookGuide";
import { SiteDiagnostics } from "./SiteDiagnostics";
import { hookGuidePlatforms } from "./hook-guide-labels";
import { toggleSiteActiveAction, updateSiteRoutingAction } from "./actions";
import { Select } from "@/components/ui/form-fields";

/** Status line for one site: green when the last attempt worked, red with the
 * reason when it didn't, grey when the site has never been used. */
async function SiteHealthBadge({
  health,
}: {
  health: import("@/modules/sites/health").SiteHealthRow | null;
}) {
  const t = await getTranslations("app.sites.health");
  const locale = await getLocale();
  const status = siteHealthStatus(health);

  if (status === "idle") {
    return <p className="text-sm text-muted-foreground">● {t("idle")}</p>;
  }

  if (status === "failing" && health?.lastErrorAt) {
    return (
      <p className="text-sm text-destructive">
        ●{" "}
        {t("failing", {
          status: health.lastErrorStatus ?? 0,
          reason: t(`reasons.${ingestReasonKey(health.lastErrorReason)}` as "reasons.unknown"),
          when: formatDateTime(health.lastErrorAt, locale),
        })}
      </p>
    );
  }

  return (
    <p className="text-sm text-success">
      ● {t("ok", { when: health?.lastSuccessAt ? formatDateTime(health.lastSuccessAt, locale) : "" })}
      {health?.errorCount ? ` · ${t("errorCount", { count: health.errorCount })}` : ""}
    </p>
  );
}

export default async function SitesPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.sites");
  const locale = await getLocale();

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const tg = await getTranslations("app.sites.guide");

  const [sites, pipelines, waAccounts, stats, tenant, health] = await Promise.all([
    listSites(ctx),
    listPipelines(ctx),
    listAccountsForTenant(ctx),
    getLeadStats(ctx),
    getTenant(ctx.tenantId),
    listSiteHealth(ctx),
  ]);

  // Per-site ingest health (PLAN.md §5.2): a client site that breaks fails on
  // THEIR server, so the CRM's only symptom is silence. This is where that
  // silence gets a name.
  const healthBySite = new Map(health.map((row) => [row.siteId, row]));

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
  };

  const guideLabels: GuideLabels = {
    title: tg("title"),
    intro: tg("intro"),
    steps: (["create", "env", "handler", "verify"] as const).map((key) => ({
      title: tg(`steps.${key}.title`),
      body: tg(`steps.${key}.body`),
    })),
    snippetTitle: tg("snippetTitle"),
    copy: tg("copy"),
    copied: tg("copied"),
    securityTitle: tg("securityTitle"),
    securityPoints: (["serverSide", "idempotency", "phone", "spam", "nonBlocking"] as const).map(
      (key) => tg(`security.${key}`),
    ),
  };

  // Lane-2 connection guide (PLAN.md §5.2.5). Built here so the client
  // component stays a renderer and every string still comes from next-intl.
  const th = await getTranslations("app.sites.hookGuide");
  const hookGuideLabels: HookGuideLabels = {
    title: th("title"),
    intro: th("intro"),
    captureTitle: th("captureTitle"),
    captureBody: th("captureBody"),
    urlNote: th("urlNote"),
    // `platforms` is stored as an ordered array, not an object keyed by id
    // (see src/i18n/messages.test.ts), so it has to be read whole with
    // t.raw(). Addressing it as `platforms.elementor.label` resolves nothing
    // and left the page rendering key paths with undefined steps.
    //
    // Validated rather than cast: t.raw() returns the JSON unchecked, and a
    // cast that turns out to be wrong reaches the client component as a
    // string it will call .map() on. See hook-guide-labels.ts.
    platforms: hookGuidePlatforms(th.raw("platforms")),
  };

  const leadsBySite = new Map(stats.bySite.map((bucket) => [bucket.key, bucket.count]));

  // Two-active-key rotation (PLAN.md §5.2). Dates are formatted here, on the
  // server, so the client component stays a plain renderer.
  const keysBySite = new Map<string, ApiKeyRow[]>(
    await Promise.all(
      sites.map(async (site): Promise<[string, ApiKeyRow[]]> => [
        site.id,
        (await listApiKeys(ctx, site.id)).map((key) => ({
          id: key.id,
          prefix: key.apiKeyPrefix,
          label: key.label,
          lastUsedAt: key.lastUsedAt ? formatDateTime(key.lastUsedAt, locale) : null,
          revoked: !!key.revokedAt,
        })),
      ]),
    ),
  );

  // Webhook lane (PLAN.md §5.2). The newest captured payload supplies the
  // paths the mapping picker offers, so the admin chooses from their own test
  // submission instead of typing a JSON path.
  const hookPanels = new Map<string, HookPanelProps>(
    await Promise.all(
      sites.map(async (site): Promise<[string, HookPanelProps]> => {
        const captures = site.hookTokenHash ? await listHookCaptures(ctx, site.id) : [];
        return [
          site.id,
          {
            siteId: site.id,
            hookUrl: `${env.APP_URL}/api/v1/hooks/__TOKEN__`,
            tokenPrefix: site.hookTokenPrefix,
            lastUsedAt: site.hookTokenLastUsedAt
              ? formatDateTime(site.hookTokenLastUsedAt, locale)
              : null,
            mapping: siteHookMapping(site),
            captureCount: captures.length,
            leaves: captureLeafPaths(captures[0]),
          },
        ];
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <PageHeader title={t("title")} description={t("intro")} />

        <div className="flex gap-6 text-sm">
          <span>
            <strong>{stats.total}</strong> {t("totalLeads")}
          </span>
          <span>
            <strong>{stats.withDeal}</strong> {t("leadsWithDeal")}
          </span>
        </div>

        {/* One row of anchors so a site can be found in a click when the
            list is long — every card carries an id keyed by slug. */}
        {sites.length > 1 && (
          <nav aria-label={t("jumpTo")} className="flex flex-wrap gap-2 text-sm">
            {sites.map((site) => (
              <a
                key={site.id}
                href={`#site-${site.slug}`}
                className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {site.name}
              </a>
            ))}
          </nav>
        )}

        {sites.length === 0 ? (
          <EmptyState
            icon={Globe}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            actionLabel={t("createSite")}
            actionHref="#nuevo-sitio"
          />
        ) : (
        <ul className="flex flex-col gap-4">
          {sites.map((site) => (
            <li
              key={site.id}
              id={`site-${site.slug}`}
              className="flex scroll-mt-6 flex-col gap-3 rounded-md border px-4 py-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">
                    {site.name}{" "}
                    <span className="text-sm text-muted-foreground">{site.domain}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {site.isActive ? t("active") : t("inactive")} ·{" "}
                    {leadsBySite.get(site.id) ?? 0} {t("leads")}
                  </p>
                  <SiteHealthBadge health={healthBySite.get(site.id) ?? null} />
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
                  <Select
                    name="defaultStageId"
                    defaultValue={site.defaultStageId ?? ""}
                    className="px-2 py-1"
                  >
                    <option value="">{t("none")}</option>
                    {stageOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  {t("waAccount")}
                  <Select
                    name="waAccountId"
                    defaultValue={site.waAccountId ?? ""}
                    className="px-2 py-1"
                  >
                    <option value="">{t("none")}</option>
                    {waAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayNumber || account.phoneNumberId}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button type="submit" size="sm" variant="outline">
                  {t("saveRouting")}
                </Button>
              </form>

              <SiteDiagnostics
                site={{ id: site.id, slug: site.slug, isActive: site.isActive }}
                health={healthBySite.get(site.id) ?? null}
                appUrl={env.APP_URL}
                hasStage={!!site.defaultStageId}
              />

              <p className="text-sm font-medium">{t("keysTitle")}</p>
              <SiteKeysPanel
                siteId={site.id}
                keys={keysBySite.get(site.id) ?? []}
                labels={labels}
                maxActive={MAX_ACTIVE_KEYS_PER_SITE}
              />

              <SiteHookForm {...hookPanels.get(site.id)!} />

              <SiteTurnstileForm
                siteId={site.id}
                configured={!!siteSettings(site).turnstile}
                siteKey={siteTurnstileSiteKey(site)}
                requireOnIngest={siteSettings(site).turnstile?.requireOnIngest ?? false}
              />
            </li>
          ))}
        </ul>
        )}
      </section>

      <section id="nuevo-sitio" className="scroll-mt-6">
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

      <SiteHookGuide labels={hookGuideLabels} />

      <SiteGuide
        appUrl={env.APP_URL}
        formEndpointExample={`${env.APP_URL}/f/${tenant?.slug ?? "tu-empresa"}/contacto`}
        labels={guideLabels}
      />

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
