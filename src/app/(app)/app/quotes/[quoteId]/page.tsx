import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getQuote, listQuoteItems } from "@/modules/quotes/service";
import { getContact } from "@/modules/crm/contacts";
import { storage } from "@/lib/storage";
import { env } from "@/lib/config/env";
import { sendQuoteAction } from "../actions";
import { Button } from "@/components/ui/button";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  const { quoteId } = await params;
  const t = await getTranslations("app");
  const ctx = await requireTenantContext();

  const quote = await getQuote(ctx, quoteId);
  if (!quote) notFound();

  const [items, contact] = await Promise.all([
    listQuoteItems(ctx, quoteId),
    getContact(ctx, quote.contactId),
  ]);

  const pdfUrl = quote.pdfStorageKey
    ? await storage.getSignedUrl(quote.pdfStorageKey)
    : null;
  const publicUrl = `${env.APP_URL}/q/${quote.publicToken}`;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {t("quoteNumber")} {quote.number}
          </h1>
          <p className="text-sm text-muted-foreground">
            {contact?.name} · {t(quote.status)}
          </p>
        </div>
        <div className="flex gap-2">
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noreferrer">
              <Button type="button" variant="outline" size="sm">
                {t("viewPdf")}
              </Button>
            </a>
          )}
          <form action={async () => { "use server"; await sendQuoteAction(quoteId); }}>
            <Button type="submit" size="sm">
              {t("sendWhatsApp")}
            </Button>
          </form>
        </div>
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">{t("description")}</th>
              <th className="px-4 py-2 font-medium text-right">{t("qty")}</th>
              <th className="px-4 py-2 font-medium text-right">{t("unitPrice")}</th>
              <th className="px-4 py-2 font-medium text-right">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-4 py-2">{item.description}</td>
                <td className="px-4 py-2 text-right">{item.qty}</td>
                <td className="px-4 py-2 text-right">
                  {item.unitPrice.toLocaleString("es-PY")}
                </td>
                <td className="px-4 py-2 text-right">
                  {item.lineTotal.toLocaleString("es-PY")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col items-end text-sm">
        <div>
          {t("subtotal")}: {quote.subtotal.toLocaleString("es-PY")} {quote.currency}
        </div>
        {quote.discount > 0 && (
          <div>
            {t("discount")}: -{quote.discount.toLocaleString("es-PY")} {quote.currency}
          </div>
        )}
        <div className="text-lg font-semibold">
          {t("total")}: {quote.total.toLocaleString("es-PY")} {quote.currency}
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        {t("publicView")}:{" "}
        <a href={publicUrl} target="_blank" rel="noreferrer" className="hover:underline">
          {publicUrl}
        </a>
      </div>
    </div>
  );
}
