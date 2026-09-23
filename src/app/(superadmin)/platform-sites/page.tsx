import { Globe } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireSuperadminContext } from "@/modules/tenancy/context";
import { listPlatformSites } from "@/modules/tenancy/console-sites";
import { ingestReasonKey } from "@/modules/sites/health";
import { env } from "@/lib/config/env";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PlatformSitesTable } from "./PlatformSitesTable";

// Every site across every business (see PlatformSitesTable for the filters).
// Defense in depth (§3.3): the layout already redirects a non-superadmin,
// this page re-checks for itself.
export default async function PlatformSitesPage() {
  await requireSuperadminContext();
  const t = await getTranslations("superadmin.platformSites");
  const th = await getTranslations("app.sites.health");
  const sites = await listPlatformSites();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />
      {sites.length === 0 ? (
        <EmptyState
          icon={Globe}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          actionLabel={t("emptyAction")}
          actionHref="/claude-ops"
        />
      ) : (
        <PlatformSitesTable
          now={new Date().toISOString()}
          appUrl={env.APP_URL}
          sites={sites.map((site) => ({
            siteId: site.siteId,
            tenantId: site.tenantId,
            tenantName: site.tenantName,
            domain: site.domain,
            slug: site.slug,
            isActive: site.isActive,
            health: site.health,
            lastSuccessAt: site.lastSuccessAt?.toISOString() ?? null,
            lastErrorAt: site.lastErrorAt?.toISOString() ?? null,
            lastErrorReason: site.lastErrorReason
              ? th(`reasons.${ingestReasonKey(site.lastErrorReason)}` as "reasons.unknown")
              : null,
            activeKeys: site.activeKeys,
          }))}
        />
      )}
    </div>
  );
}
