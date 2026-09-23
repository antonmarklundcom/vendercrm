import Link from "next/link";
import { ScrollText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listDocuments, amountPaid } from "@/modules/documents/documents";
import { paymentStateOf, type DocumentStatus } from "@/modules/documents/types";
import { listProducts } from "@/modules/quotes/products";
import { listContacts } from "@/modules/crm/contacts";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CreateDialog } from "@/components/create-dialog";
import { DocumentBuilder, type DocumentBuilderLabels } from "./DocumentBuilder";
import { formatMoney } from "@/lib/i18n/format";
import { getLocale } from "next-intl/server";

export default async function DocumentsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.documents");
  const tc = await getTranslations("common");
  const locale = await getLocale();

  const [documents, contacts, products] = await Promise.all([
    listDocuments(ctx),
    listContacts(ctx),
    listProducts(ctx),
  ]);

  const rows = await Promise.all(
    documents.map(async (document) => ({
      document,
      paid: await amountPaid(ctx, document.id),
    })),
  );

  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  const labels: DocumentBuilderLabels = {
    contact: t("contact"),
    description: t("description"),
    qty: t("qty"),
    unitPrice: t("unitPrice"),
    lineTotal: t("lineTotal"),
    addLine: t("addLine"),
    removeLine: t("removeLine"),
    fromCatalog: t("fromCatalog"),
    freeText: t("freeText"),
    discount: t("discount"),
    dueAt: t("dueAt"),
    notes: t("notes"),
    subtotal: t("subtotal"),
    total: t("total"),
    submit: t("create"),
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <PageHeader
          title={t("title")}
          description={t("intro")}
          action={
            <CreateDialog
              id="nueva-nota"
              triggerLabel={t("createTitle")}
              title={t("createTitle")}
              closeLabel={tc("close")}
              wide
            >
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("needContact")}{" "}
                  <Link href="/contacts" className="underline underline-offset-4">
                    {t("goToContacts")}
                  </Link>
                </p>
              ) : (
                <DocumentBuilder
                  mode="create"
                  contacts={contacts.map((c) => ({ id: c.id, label: `${c.name} — ${c.phone}` }))}
                  products={products.map((p) => ({ id: p.id, name: p.name, unitPrice: p.unitPrice }))}
                  labels={labels}
                />
              )}
            </CreateDialog>
          }
        />

        {documents.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            actionLabel={contacts.length > 0 ? t("create") : undefined}
            actionHref={contacts.length > 0 ? "#nueva-nota" : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2">{t("number")}</th>
                  <th className="py-2">{t("contact")}</th>
                  <th className="py-2">{t("status")}</th>
                  <th className="py-2">{t("paymentState")}</th>
                  <th className="py-2 text-right">{t("total")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ document, paid }) => {
                  const state = paymentStateOf(
                    document.status as DocumentStatus,
                    document.total,
                    paid,
                  );
                  return (
                    <tr key={document.id} className="border-b">
                      <td className="py-2">
                        <Link href={`/documents/${document.id}`} className="underline">
                          {document.number}
                        </Link>
                      </td>
                      <td className="py-2">
                        {contactsById.get(document.contactId)?.name ?? document.contactId}
                      </td>
                      <td className="py-2">
                        {t(`statusValues.${document.status}` as "statusValues.draft")}
                      </td>
                      <td className="py-2">
                        {t(`paymentStateValues.${state}` as "paymentStateValues.unpaid")}
                      </td>
                      <td className="py-2 text-right">
                        {formatMoney(document.total, document.currency, locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
