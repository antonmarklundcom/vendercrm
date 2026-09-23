import { Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireSuperadminContext } from "@/modules/tenancy/context";
import { listTenantsForConsole } from "@/modules/tenancy/console";
import { CreateDialog } from "@/components/create-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CreateTenantForm } from "./CreateTenantForm";
import { TenantTable } from "./TenantTable";

// Defense in depth (§3.3): the (superadmin) layout already redirects a
// non-superadmin, but a layout is not an authorization boundary — this page
// re-checks for itself, the same as whatsapp-health.
export default async function TenantsPage() {
  await requireSuperadminContext();
  const t = await getTranslations("superadmin.tenants");
  const tc = await getTranslations("common");
  const tenants = await listTenantsForConsole();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        action={
          <CreateDialog
            id="nueva-empresa"
            triggerLabel={t("createTitle")}
            title={t("createTitle")}
            closeLabel={tc("close")}
          >
            <CreateTenantForm />
          </CreateDialog>
        }
      />

      {tenants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          actionLabel={t("createTitle")}
          actionHref="#nueva-empresa"
        />
      ) : (
        <TenantTable
          now={new Date().toISOString()}
          rows={tenants.map((tenant) => ({
            ...tenant,
            createdAt: tenant.createdAt.toISOString(),
            lastLeadAt: tenant.lastLeadAt?.toISOString() ?? null,
          }))}
        />
      )}
    </div>
  );
}
