import Link from "next/link";
import { Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listCompanies } from "@/modules/crm/companies";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CompanyForm } from "./CompanyForm";
import { createCompanyAction } from "./actions";

export default async function CompaniesPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.companies");

  const companies = await listCompanies(ctx);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro")} />

      {companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          actionLabel={t("createTitle")}
          actionHref="#nueva-empresa"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2">{t("table.name")}</th>
                <th className="py-2 text-right">{t("table.contacts")}</th>
                <th className="py-2 text-right">{t("table.openDeals")}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="border-b">
                  <td className="py-2">
                    <Link href={`/companies/${company.id}`} className="underline">
                      {company.name}
                    </Link>
                  </td>
                  <td className="py-2 text-right">{company.contactCount}</td>
                  <td className="py-2 text-right">{company.openDealCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section id="nueva-empresa" className="scroll-mt-6">
        <h2 className="mb-4 text-lg font-semibold">{t("createTitle")}</h2>
        <CompanyForm
          action={createCompanyAction}
          labels={{
            name: t("name"),
            ruc: t("ruc"),
            phone: t("phone"),
            email: t("email"),
            address: t("address"),
            notes: t("notes"),
            submit: t("createTitle"),
            errors: { invalid: t("errors.invalid"), nameTaken: t("errors.nameTaken") },
          }}
        />
      </section>
    </div>
  );
}
