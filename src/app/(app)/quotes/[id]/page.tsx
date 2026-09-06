import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getQuote, listQuoteItems } from "@/modules/quotes/quotes";
import { publicQuoteUrl } from "@/modules/quotes/delivery";
import { getQuoteDecision } from "@/modules/quotes/public";
import { getDocumentByQuote } from "@/modules/documents/documents";
import { getContact } from "@/modules/crm/contacts";
import { Button } from "@/components/ui/button";
import {
  sendQuoteAction,
  sendQuoteByEmailAction,
  setQuoteStatusAction,
  convertQuoteToDocumentAction,
  duplicateQuoteAction,
} from "../actions";
import { formatMoney } from "@/lib/i18n/format";
import { getLocale } from "next-intl/server";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.quotes");
  const locale = await getLocale();
  const td = await getTranslations("app.documents");

  const quote = await getQuote(ctx, id);
  if (!quote) notFound();

  const [items, contact, existingDocument, decision] = await Promise.all([
    listQuoteItems(ctx, quote.id),
    getContact(ctx, quote.contactId),
    getDocumentByQuote(ctx, quote.id),
    getQuoteDecision(quote.id, ctx.tenantId),
  ]);

  const fmt = (n: number) => formatMoney(n, quote.currency, locale);
  const publicUrl = publicQuoteUrl(quote.publicToken);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{quote.number}</h1>
          <p className="text-sm text-muted-foreground">
            {contact?.name} · {contact?.phone}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(`statusValues.${quote.status}` as "statusValues.draft")}
          </p>
          {decision && (
            <p className="text-sm text-muted-foreground">
              {t(
                decision.decision === "accepted"
                  ? "decisionAcceptedBy"
                  : "decisionRejectedBy",
                { name: decision.name },
              )}
              {decision.comment ? ` — "${decision.comment}"` : ""}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <form action={sendQuoteAction}>
            <input type="hidden" name="quoteId" value={quote.id} />
            <Button type="submit">{t("sendWhatsapp")}</Button>
          </form>
          {contact?.email && (
            <form action={sendQuoteByEmailAction}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <Button type="submit" variant="outline">
                {t("sendEmail")}
              </Button>
            </form>
          )}
        </div>
      </header>

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
          <span>{fmt(quote.subtotal)}</span>
        </div>
        {quote.discount > 0 && (
          <div className="flex w-56 justify-between">
            <span>{t("discount")}</span>
            <span>-{fmt(quote.discount)}</span>
          </div>
        )}
        <div className="flex w-56 justify-between text-base font-semibold">
          <span>{t("total")}</span>
          <span>{fmt(quote.total)}</span>
        </div>
      </div>

      <section className="flex flex-col gap-2 text-sm">
        <p>
          {t("publicLink")}:{" "}
          <a href={publicUrl} className="underline">
            {publicUrl}
          </a>
        </p>
        <a href={`/q/${quote.publicToken}/pdf`} className="underline">
          {t("downloadPdf")}
        </a>
      </section>

      {quote.status === "expired" && (
        <section>
          <form action={duplicateQuoteAction}>
            <input type="hidden" name="quoteId" value={quote.id} />
            <Button type="submit" size="sm" variant="outline">
              {t("duplicateExpired")}
            </Button>
          </form>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-2">
        {(["accepted", "rejected"] as const).map((status) => (
          <form key={status} action={setQuoteStatusAction}>
            <input type="hidden" name="quoteId" value={quote.id} />
            <input type="hidden" name="status" value={status} />
            <Button type="submit" size="sm" variant="outline">
              {t(`markAs.${status}` as "markAs.accepted")}
            </Button>
          </form>
        ))}

        {existingDocument ? (
          <Link
            href={`/documents/${existingDocument.id}`}
            className="text-sm underline underline-offset-4"
          >
            {td("viewDocument")} ({existingDocument.number})
          </Link>
        ) : (
          <form action={convertQuoteToDocumentAction}>
            <input type="hidden" name="quoteId" value={quote.id} />
            <Button type="submit" size="sm" variant="outline">
              {td("convertFromQuote")}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
