import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getReceiptByPublicToken } from "@/modules/documents/receipts";
import { getContact } from "@/modules/crm/contacts";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslator } from "@/lib/i18n/translator";
import { documentDate as date, money } from "@/modules/renderable-document/format";

// Public read-only receipt view (PLAN.md §15.2, §15.8 P6) — the token is the
// secret, same model as the quote and nota de venta links.
export default async function PublicReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const ip = clientIp(await headers());
  if ((await checkRateLimit(`receipt-view:${ip}`, 60, 60_000)).limited) {
    const tLimit = await getTranslator(null, "public.shared");
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        {tLimit("rateLimited")}
      </main>
    );
  }

  const resolved = await getReceiptByPublicToken(token);
  if (!resolved) notFound();

  const { payment, document, ctx } = resolved;
  const [contact, tenant] = await Promise.all([
    getContact(ctx, document.contactId),
    getTenant(document.tenantId),
  ]);
  const branding = ((tenant?.settings ?? {}) as TenantSettings).branding ?? {};
  const accent = branding.primaryColor || undefined;

  const locale = tenant?.locale ?? "es";
  const t = await getTranslator(locale, "public.receipt");

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
          <p className="text-sm text-muted-foreground">{payment.receiptNumber}</p>
          <p className="text-sm text-muted-foreground">{date(payment.paidAt, locale)}</p>
        </div>
      </header>

      <section className="text-sm">
        <p className="text-muted-foreground">{t("client")}</p>
        <p>{contact?.name}</p>
        <p className="text-muted-foreground">{contact?.phone}</p>
        <p className="mt-2">
          {t("againstDocument")} {document.number}
        </p>
      </section>

      <section className="text-sm">
        <p>{t(`method.${payment.method}` as "method.cash")}</p>
        {payment.reference && <p className="text-muted-foreground">{payment.reference}</p>}
      </section>

      <div className="flex w-full max-w-xs flex-col self-end text-base font-semibold">
        <div className="flex justify-between">
          <span>{t("total")}</span>
          <span style={{ color: accent }}>{money(payment.amount, payment.currency, locale)}</span>
        </div>
      </div>

      <a href={`/r/${token}/pdf`} className="text-sm underline">
        {t("downloadPdf")}
      </a>

      <p className="rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning">
        {t("disclaimer")}
      </p>

      <footer className="mt-8 text-center text-xs text-muted-foreground">{tenant?.name}</footer>
    </main>
  );
}
