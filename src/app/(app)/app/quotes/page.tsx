import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listQuotes } from "@/modules/quotes/service";
import { getContact } from "@/modules/crm/contacts";

export default async function QuotesPage() {
  const t = await getTranslations("app");
  const ctx = await requireTenantContext();
  const quotes = await listQuotes(ctx);
  const contacts = await Promise.all(
    quotes.map((q) => getContact(ctx, q.contactId)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("quotes")}</h1>
        <Link
          href="/app/quotes/products"
          className="text-sm text-muted-foreground hover:underline"
        >
          {t("products")}
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">{t("quoteNumber")}</th>
              <th className="px-4 py-2 font-medium">{t("contact")}</th>
              <th className="px-4 py-2 font-medium">{t("total")}</th>
              <th className="px-4 py-2 font-medium">{t("quoteStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q, i) => (
              <tr key={q.id} className="border-t">
                <td className="px-4 py-2">
                  <Link href={`/app/quotes/${q.id}`} className="font-medium hover:underline">
                    {q.number}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {contacts[i]?.name ?? "—"}
                </td>
                <td className="px-4 py-2">
                  {q.total.toLocaleString("es-PY")} {q.currency}
                </td>
                <td className="px-4 py-2">{t(q.status)}</td>
              </tr>
            ))}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  {t("noQuotes")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
