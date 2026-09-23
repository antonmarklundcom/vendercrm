import Link from "next/link";
import { FileSignature } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import {
  ensureDefaultContractTemplates,
  listContractTemplates,
  listContracts,
} from "@/modules/contracts/contracts";
import { listContacts } from "@/modules/crm/contacts";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CreateDialog } from "@/components/create-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createContractAction } from "./actions";
import { ContractCreateForm } from "./ContractCreateForm";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string; dealId?: string; quoteId?: string }>;
}) {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.contracts");
  const tc = await getTranslations("common");
  const { contactId, dealId, quoteId } = await searchParams;

  await ensureDefaultContractTemplates(ctx);

  const [contracts, templates, contacts] = await Promise.all([
    listContracts(ctx),
    listContractTemplates(ctx),
    listContacts(ctx),
  ]);

  const activeTemplates = templates.filter((tpl) => tpl.isActive);
  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        action={
          <>
            <Link href="/contracts/templates" className={cn(buttonVariants({ variant: "ghost" }))}>
              {t("manageTemplates")}
            </Link>
            <CreateDialog
              id="nuevo-contrato"
              triggerLabel={t("createTitle")}
              title={t("createTitle")}
              closeLabel={tc("close")}
            >
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("needContact")}{" "}
                  <Link href="/contacts" className="underline underline-offset-4">
                    {t("goToContacts")}
                  </Link>
                </p>
              ) : activeTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("needTemplate")}{" "}
                  <Link href="/contracts/templates" className="underline underline-offset-4">
                    {t("manageTemplates")}
                  </Link>
                </p>
              ) : (
                <ContractCreateForm
                  action={createContractAction}
                  contacts={contacts.map((c) => ({ id: c.id, label: `${c.name} — ${c.phone}` }))}
                  templates={activeTemplates.map((tpl) => ({ id: tpl.id, name: tpl.name }))}
                  defaults={{ contactId: contactId ?? "", dealId: dealId ?? "", quoteId: quoteId ?? "" }}
                  labels={{
                    contact: t("contact"),
                    template: t("template"),
                    submit: t("createTitle"),
                    errors: { invalid: t("errors.invalid") },
                  }}
                />
              )}
            </CreateDialog>
          </>
        }
      />

      {contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          actionLabel={contacts.length > 0 ? t("createTitle") : undefined}
          actionHref={contacts.length > 0 ? "#nuevo-contrato" : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2">{t("number")}</th>
                <th className="py-2">{t("contact")}</th>
                <th className="py-2">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id} className="border-b">
                  <td className="py-2">
                    <Link href={`/contracts/${contract.id}`} className="underline">
                      {contract.number}
                    </Link>
                  </td>
                  <td className="py-2">
                    {contactsById.get(contract.contactId)?.name ?? contract.contactId}
                  </td>
                  <td className="py-2">
                    {t(`statusValues.${contract.status}` as "statusValues.draft")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
