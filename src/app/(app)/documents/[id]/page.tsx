import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import {
  getDocument,
  listDocumentItems,
  getDocumentTotals,
  listPayments,
} from "@/modules/documents/documents";
import { publicDocumentUrl } from "@/modules/documents/delivery";
import { listProducts } from "@/modules/quotes/products";
import { getContact } from "@/modules/crm/contacts";
import { Button } from "@/components/ui/button";
import { DocumentBuilder, type DocumentBuilderLabels } from "../DocumentBuilder";
import {
  issueDocumentAction,
  sendDocumentAction,
  sendDocumentByEmailAction,
  deletePaymentAction,
} from "../actions";
import { RecordPaymentForm, VoidDocumentForm } from "./DocumentActionForms";
import { formatMoney } from "@/lib/i18n/format";
import { getLocale } from "next-intl/server";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.documents");
  const locale = await getLocale();

  // Agents sell — issue documents, record payments — but the two destructive,
  // ledger-rewriting controls (void, delete payment) are admin-only (§3.2).
  const isAdmin = ctx.role === "admin";

  const document = await getDocument(ctx, id);
  if (!document) notFound();

  const [items, totals, payments, contact, products] = await Promise.all([
    listDocumentItems(ctx, document.id),
    getDocumentTotals(ctx, document.id),
    listPayments(ctx, document.id),
    getContact(ctx, document.contactId),
    listProducts(ctx),
  ]);

  const fmt = (n: number) => formatMoney(n, document.currency, locale);
  const publicUrl = publicDocumentUrl(document.publicToken);

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
    submit: t("save"),
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{document.number}</h1>
          <p className="text-sm text-muted-foreground">
            {contact?.name} · {contact?.phone}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(`statusValues.${document.status}` as "statusValues.draft")}
            {totals && document.status !== "draft" && (
              <>
                {" · "}
                {t(`paymentStateValues.${totals.state}` as "paymentStateValues.unpaid")}
              </>
            )}
          </p>
        </div>

        {document.status === "issued" && (
          <div className="flex gap-2">
            <form action={sendDocumentAction}>
              <input type="hidden" name="documentId" value={document.id} />
              <Button type="submit">{t("sendWhatsapp")}</Button>
            </form>
            {contact?.email && (
              <form action={sendDocumentByEmailAction}>
                <input type="hidden" name="documentId" value={document.id} />
                <Button type="submit" variant="outline">
                  {t("sendEmail")}
                </Button>
              </form>
            )}
          </div>
        )}
      </header>

      <p className="w-fit rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning">
        {t("nonFiscalNotice")}
      </p>

      {document.status === "void" && document.voidReason && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          {t("voidedNotice", { reason: document.voidReason })}
        </p>
      )}

      {document.status === "draft" ? (
        <>
        <h2 className="text-lg font-semibold">{t("editTitle")}</h2>
        <DocumentBuilder
          mode="edit"
          documentId={document.id}
          products={products.map((p) => ({ id: p.id, name: p.name, unitPrice: p.unitPrice }))}
          labels={labels}
          initial={{
            lines: items.map((item, index) => ({
              key: index,
              productId: item.productId ?? "",
              description: item.description,
              qty: item.qty,
              unitPrice: item.unitPrice,
            })),
            discount: document.discount,
            dueAt: document.dueAt ? document.dueAt.toISOString().slice(0, 10) : "",
            notes: document.notes ?? "",
          }}
        />
        </>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2">{t("description")}</th>
                  <th className="py-2 text-right">{t("qty")}</th>
                  <th className="py-2 text-right">{t("unitPrice")}</th>
                  <th className="py-2 text-right">{t("lineTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2">{item.description}</td>
                    <td className="py-2 text-right">{item.qty}</td>
                    <td className="py-2 text-right">{fmt(item.unitPrice)}</td>
                    <td className="py-2 text-right">{fmt(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-end gap-1 text-sm">
            <div className="flex w-56 justify-between">
              <span>{t("subtotal")}</span>
              <span>{fmt(document.subtotal)}</span>
            </div>
            {document.discount > 0 && (
              <div className="flex w-56 justify-between">
                <span>{t("discount")}</span>
                <span>-{fmt(document.discount)}</span>
              </div>
            )}
            <div className="flex w-56 justify-between text-base font-semibold">
              <span>{t("total")}</span>
              <span>{fmt(document.total)}</span>
            </div>
            {totals && (
              <>
                <div className="flex w-56 justify-between">
                  <span>{t("amountPaid")}</span>
                  <span>{fmt(totals.amountPaid)}</span>
                </div>
                <div className="flex w-56 justify-between font-medium">
                  <span>{t("balance")}</span>
                  <span>{fmt(totals.balance)}</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <section className="flex flex-col gap-2 text-sm">
        <p>
          {t("publicLink")}:{" "}
          <a href={publicUrl} className="underline">
            {publicUrl}
          </a>
        </p>
        <a href={`/d/${document.publicToken}/pdf`} className="underline">
          {t("downloadPdf")}
        </a>
      </section>

      {document.status === "draft" && (
        <section>
          <form action={issueDocumentAction} className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{t("issueWarning")}</p>
            <input type="hidden" name="documentId" value={document.id} />
            <Button type="submit" className="w-fit">
              {t("issue")}
            </Button>
          </form>
        </section>
      )}

      {document.status !== "draft" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t("paymentsTitle")}</h2>

          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2">{t("paidAt")}</th>
                    <th className="py-2">{t("method")}</th>
                    <th className="py-2">{t("reference")}</th>
                    <th className="py-2 text-right">{t("amount")}</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b">
                      <td className="py-2">{payment.paidAt.toISOString().slice(0, 10)}</td>
                      <td className="py-2">
                        {t(`methodValues.${payment.method}` as "methodValues.cash")}
                      </td>
                      <td className="py-2">{payment.reference}</td>
                      <td className="py-2 text-right">{fmt(payment.amount)}</td>
                      <td className="py-2 text-right">
                        {document.status === "issued" && isAdmin && (
                          <form action={deletePaymentAction}>
                            <input type="hidden" name="documentId" value={document.id} />
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <button type="submit" className="text-xs underline">
                              {t("deletePayment")}
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {document.status === "issued" && <RecordPaymentForm documentId={document.id} />}
        </section>
      )}

      {document.status === "issued" && isAdmin && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("voidTitle")}</h2>
          {payments.length > 0 ? (
            <p className="text-sm text-muted-foreground">{t("voidBlockedByPayments")}</p>
          ) : (
            <VoidDocumentForm documentId={document.id} />
          )}
        </section>
      )}

      <Link href="/documents" className="text-sm underline underline-offset-4">
        {t("title")}
      </Link>
    </div>
  );
}
