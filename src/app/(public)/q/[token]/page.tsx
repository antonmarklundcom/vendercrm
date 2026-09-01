import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getPublicQuote } from "@/modules/quotes/quotes";
import { getContact } from "@/modules/crm/contacts";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslator } from "@/lib/i18n/translator";
import { formatDate } from "@/lib/i18n/format";
import { money } from "@/modules/renderable-document/format";

// Public read-only quote view (PLAN.md §8) — the token is the secret, and
// there is deliberately no accept/reject button in Phase 1: the rep sets
// those by hand in the CRM.


export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Per-IP limit — the token itself is the secret, so this isn't for
  // brute-forcing defense, it's to keep the page from being scraped/hammered
  // (lib/rate-limit holds the window in MySQL, so it survives a deploy).
  const ip = clientIp(await headers());
  if ((await checkRateLimit(`quote-view:${ip}`, 60, 60_000)).limited) {
    // No tenant resolved yet at this point, so this one line is the single
    // place the reference locale is the only thing available.
    const tLimit = await getTranslator(null, "public.shared");
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        {tLimit("rateLimited")}
      </main>
    );
  }

  const resolved = await getPublicQuote(token);
  if (!resolved) notFound();

  const { quote, items, ctx } = resolved;
  const [contact, tenant] = await Promise.all([
    getContact(ctx, quote.contactId),
    getTenant(quote.tenantId),
  ]);
  const branding = ((tenant?.settings ?? {}) as TenantSettings).branding ?? {};
  const accent = branding.primaryColor || undefined;

  // The tenant's language, not the reader's browser: this page is the same
  // artifact as the PDF beside it (PLAN.md §13 H5 #4).
  const locale = tenant?.locale ?? "es";
  const t = await getTranslator(locale, "public.quote");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied external URL, no loader configured
            <img src={branding.logoUrl} alt={tenant?.name ?? ""} className="max-h-12" />
          ) : (
            <h1 className="text-lg font-semibold" style={{ color: accent }}>
              {tenant?.name}
            </h1>
          )}
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold" style={{ color: accent }}>
            {t("title")}
          </p>
          <p className="text-sm text-muted-foreground">{quote.number}</p>
          <p className="text-sm text-muted-foreground">
            {formatDate(quote.createdAt, locale)}
          </p>
        </div>
      </header>

      <section className="text-sm">
        <p className="text-muted-foreground">{t("client")}</p>
        <p>{contact?.name}</p>
        <p>{contact?.phone}</p>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">{t("description")}</th>
              <th className="py-2 text-right">{t("qty")}</th>
              <th className="py-2 text-right">{t("price")}</th>
              <th className="py-2 text-right">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-right">{item.qty}</td>
                <td className="py-2 text-right">{money(item.unitPrice, quote.currency, locale)}</td>
                <td className="py-2 text-right">{money(item.lineTotal, quote.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col items-end gap-1 text-sm">
        <div className="flex w-56 justify-between">
          <span>{t("subtotal")}</span>
          <span>{money(quote.subtotal, quote.currency, locale)}</span>
        </div>
        {quote.discount > 0 && (
          <div className="flex w-56 justify-between">
            <span>{t("discount")}</span>
            <span>-{money(quote.discount, quote.currency, locale)}</span>
          </div>
        )}
        <div className="flex w-56 justify-between text-base font-semibold">
          <span>{t("total")}</span>
          <span style={{ color: accent }}>{money(quote.total, quote.currency, locale)}</span>
        </div>
      </div>

      {quote.validUntil && (
        <p className="text-sm text-muted-foreground">
          {t("validUntil")} {formatDate(quote.validUntil, locale)}
        </p>
      )}
      {quote.notes && <p className="text-sm">{quote.notes}</p>}

      <a href={`/q/${token}/pdf`} className="text-sm underline">
        {t("downloadPdf")}
      </a>

      <footer className="mt-8 text-center text-xs text-muted-foreground">
        {t("footer")}
      </footer>
    </main>
  );
}
