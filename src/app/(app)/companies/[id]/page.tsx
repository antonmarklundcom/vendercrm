import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import {
  getCompany,
  listContactsForCompany,
  listDealsForCompany,
} from "@/modules/crm/companies";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { CompanyForm } from "../CompanyForm";
import { updateCompanyAction, deleteCompanyAction } from "../actions";

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deleteError?: string }>;
}) {
  const { id } = await params;
  const { deleteError } = await searchParams;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.companies");

  const company = await getCompany(ctx, id);
  if (!company) notFound();

  const [companyContacts, companyDeals] = await Promise.all([
    listContactsForCompany(ctx, id),
    listDealsForCompany(ctx, id),
  ]);

  const boundUpdateAction = updateCompanyAction.bind(null, id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={company.name} />

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("contactsTitle")}</h2>
        {companyContacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("contactsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {companyContacts.map((contact) => (
              <li key={contact.id}>
                <Link href={`/contacts/${contact.id}`} className="text-sm underline">
                  {contact.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("dealsTitle")}</h2>
        {companyDeals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dealsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {companyDeals.map((deal) => (
              <li key={deal.id} className="text-sm">
                {deal.title} — {deal.value} {deal.currency}
                {deal.closedAt ? "" : ` (${t("table.openDeals")})`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("editTitle")}</h2>
        <CompanyForm
          action={boundUpdateAction}
          defaults={{
            name: company.name,
            ruc: company.ruc ?? "",
            phone: company.phone ?? "",
            email: company.email ?? "",
            address: company.address ?? "",
            notes: company.notes ?? "",
          }}
          labels={{
            name: t("name"),
            ruc: t("ruc"),
            phone: t("phone"),
            email: t("email"),
            address: t("address"),
            notes: t("notes"),
            submit: t("save"),
            errors: { invalid: t("errors.invalid"), nameTaken: t("errors.nameTaken") },
          }}
        />
      </section>

      {/* Deletion is admin-only and only while the company has no contacts
          (§10 1S pattern, same posture as contact deletion). The action
          re-checks this — the disabled state here just avoids dangling an
          option that would be refused. */}
      {ctx.role === "admin" && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("delete")}</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {companyContacts.length > 0 ? t("deleteBlocked") : t("deleteConfirm")}
          </p>
          <form action={deleteCompanyAction}>
            <input type="hidden" name="companyId" value={company.id} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={companyContacts.length > 0}
            >
              {t("delete")}
            </Button>
          </form>
          {deleteError && (
            <p className="mt-2 text-sm text-destructive">{t("deleteBlocked")}</p>
          )}
        </section>
      )}
    </div>
  );
}
