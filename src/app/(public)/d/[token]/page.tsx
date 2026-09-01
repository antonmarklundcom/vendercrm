import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getDocumentByPublicToken } from "@/modules/documents/documents";
import { getContact } from "@/modules/crm/contacts";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslator } from "@/lib/i18n/translator";
import { documentDate as date, money } from "@/modules/renderable-document/format";
import type { PaymentState } from "@/modules/documents/types";

// Public read-only nota de venta view (PLAN.md §10 1Q) — the token is the
// secret, same model as the quote link (§8). A voided document stops
// resolving upstream, so this page never shows a cancelled sale as if it
// still stood.



const STATE_CLASS: Record<PaymentState, string> = {
  unpaid: "bg-warning-surface text-warning",
  partial: "bg-warning-surface text-warning",
  paid: "bg-success-surface text-success",
  void: "bg-destructive-surface text-destructive",
};

export default async function PublicDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Per-IP limit — the token itself is the secret, so this isn't
  // brute-force defense, it's to keep the page from being hammered.
  const ip = clientIp(await headers());
  if ((await checkRateLimit(`document-view:${ip}`, 60, 60_000)).limited) {
    // No tenant resolved yet, so the reference locale is all there is.
    const tLimit = await getTranslator(null, "public.shared");
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        {tLimit("rateLimited")}
      </main>
    );
  }

  const resolved = await getDocumentByPublicToken(token);
  if (!resolved) notFound();

  const { document, items, amountPaid, balance, state, ctx } = resolved;
  const [contact, tenant] = await Promise.all([
    getContact(ctx, document.contactId),
    getTenant(document.tenantId),
  ]);
  const branding = ((tenant?.settings ?? {}) as TenantSettings).branding ?? {};
  const accent = branding.primaryColor || undefined;

  // Tenant locale: this page is read by their customer (PLAN.md §13 H5 #4).
  const locale = tenant?.locale ?? "es";
  const t = await getTranslator(locale, "public.document");

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
          <p className="text-sm text-muted-foreground">{document.number}</p>
          <p className="text-sm text-muted-foreground">
            {date(document.issuedAt ?? document.createdAt, locale)}
          </p>
          <span
            className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${STATE_CLASS[state]}`}
          >
            {t(`state.${state}`)}
          </span>
        </div>
      </header>

      <section className="text-sm">
        <p className="text-muted-foreground">{t("client")}</p>
        <p>{contact?.name}</p>
        <p className="text-muted-foreground">{contact?.phone}</p>
        {document.dueAt && (
          <p className="mt-2">
            {t("dueAt")} {date(document.dueAt, locale)}
          </p>
        )}
      </section>

      <section>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
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
                  <td className="py-2 text-right">
                    {money(item.unitPrice, document.currency, locale)}
                  </td>
                  <td className="py-2 text-right">
                    {money(item.lineTotal, document.currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ml-auto w-full max-w-xs text-sm">
        <div className="flex justify-between py-1">
          <span>{t("subtotal")}</span>
          <span>{money(document.subtotal, document.currency, locale)}</span>
        </div>
        {document.discount > 0 && (
          <div className="flex justify-between py-1">
            <span>{t("discount")}</span>
            <span>-{money(document.discount, document.currency, locale)}</span>
          </div>
        )}
        <div className="flex justify-between border-t py-1 font-semibold">
          <span>{t("total")}</span>
          <span style={{ color: accent }}>{money(document.total, document.currency, locale)}</span>
        </div>
        {amountPaid > 0 && (
          <div className="flex justify-between py-1">
            <span>{t("paid")}</span>
            <span>-{money(amountPaid, document.currency, locale)}</span>
          </div>
        )}
        <div className="flex justify-between border-t py-2 font-semibold">
          <span>{t("balance")}</span>
          <span>{money(balance, document.currency, locale)}</span>
        </div>
      </section>

      {document.notes && (
        <section className="text-sm">
          <p className="text-muted-foreground">{t("notes")}</p>
          <p className="whitespace-pre-wrap">{document.notes}</p>
        </section>
      )}

      <a
        href={`/d/${token}/pdf`}
        className="w-fit rounded-md border px-4 py-2 text-sm hover:bg-accent"
      >
        {t("downloadPdf")}
      </a>

      {/* Shown on the page as well as the PDF: whoever receives this link
          must be able to tell it is not a factura without opening the file. */}
      <p className="rounded-md border bg-muted p-3 text-xs text-muted-foreground">
        {t("disclaimer")}
      </p>
    </main>
  );
}
