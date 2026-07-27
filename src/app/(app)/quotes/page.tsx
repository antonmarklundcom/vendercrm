import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listQuotes } from "@/modules/quotes/quotes";
import { listProducts } from "@/modules/quotes/products";
import { listContacts } from "@/modules/crm/contacts";
import { QuoteBuilder, type BuilderLabels } from "./QuoteBuilder";

export default async function QuotesPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.quotes");

  const [quotes, contacts, products] = await Promise.all([
    listQuotes(ctx),
    listContacts(ctx),
    listProducts(ctx),
  ]);

  const labels: BuilderLabels = {
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
    validUntil: t("validUntil"),
    notes: t("notes"),
    subtotal: t("subtotal"),
    total: t("total"),
    create: t("createQuote"),
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">{t("number")}</th>
              <th className="py-2">{t("status")}</th>
              <th className="py-2 text-right">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => (
              <tr key={quote.id} className="border-b">
                <td className="py-2">
                  <Link href={`/quotes/${quote.id}`} className="underline">
                    {quote.number}
                  </Link>
                </td>
                <td className="py-2">{t(`statusValues.${quote.status}` as "statusValues.draft")}</td>
                <td className="py-2 text-right">
                  {new Intl.NumberFormat("es-PY").format(quote.total)} {quote.currency}
                </td>
              </tr>
            ))}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("createTitle")}</h2>
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("needContact")}</p>
        ) : (
          <QuoteBuilder
            contacts={contacts.map((c) => ({ id: c.id, label: `${c.name} — ${c.phone}` }))}
            products={products.map((p) => ({ id: p.id, name: p.name, unitPrice: p.unitPrice }))}
            labels={labels}
          />
        )}
      </section>
    </div>
  );
}
