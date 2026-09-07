// React must be in scope explicitly here — same reason as the shell it
// builds on (modules/renderable-document/pdf.tsx): this module is reachable
// from the worker entry, which runs through tsx/esbuild and honours
// tsconfig's `jsx: "preserve"` as the classic runtime.
import React from "react";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { TenantBranding } from "@/modules/tenancy/settings";
import { getTranslator } from "@/lib/i18n/translator";
import {
  DocumentShell,
  styles,
  type PdfLineItem,
  type PdfTotalsRow,
} from "@/modules/renderable-document/pdf";
import { documentDate, money } from "@/modules/renderable-document/format";

// Quote PDF (PLAN.md §8), now a configuration of the shared document shell
// (§13 H9) rather than its own copy of the layout: what is left here is
// only what makes a quote a quote — the validity note, and a footer saying
// this is not a fiscal document.

export type QuotePdfData = {
  number: string;
  tenantName: string;
  branding: TenantBranding;
  contactName: string;
  contactPhone: string;
  currency: string;
  subtotal: number;
  discount: number;
  total: number;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  items: PdfLineItem[];
  /** The **tenant's** locale, never the sending rep's: this document is read
   * by their customer (PLAN.md §13 H5 #4). */
  locale?: string | null;
  /** From the memory (K3, PLAN.md §16.4) — printed only when the tenant has
   *  confirmed them, same as everywhere else the memory reaches a customer. */
  paymentMethods?: string | null;
  depositPolicy?: string | null;
};

/** Resolved by renderQuotePdf and passed in, because the react-pdf tree is
 * rendered synchronously and can't await a translator itself. */
export type QuotePdfLabels = {
  title: string;
  client: string;
  description: string;
  qty: string;
  price: string;
  total: string;
  subtotal: string;
  discount: string;
  validUntil: string;
  paymentMethods: string;
  depositPolicy: string;
  footer: string;
};

export function QuoteDocument({
  data,
  labels,
}: {
  data: QuotePdfData;
  labels: QuotePdfLabels;
}) {
  const locale = data.locale ?? "es";
  const accent = data.branding.primaryColor || "#111111";

  const totals: PdfTotalsRow[] = [
    { label: labels.subtotal, value: money(data.subtotal, data.currency, locale) },
    ...(data.discount > 0
      ? [{ label: labels.discount, value: `-${money(data.discount, data.currency, locale)}` }]
      : []),
    {
      label: labels.total,
      value: money(data.total, data.currency, locale),
      kind: "grand" as const,
      valueColor: accent,
    },
  ];

  return (
    <DocumentShell
      tenantName={data.tenantName}
      branding={data.branding}
      locale={locale}
      currency={data.currency}
      title={labels.title}
      metaLines={[data.number, documentDate(data.createdAt, locale)]}
      clientLabel={labels.client}
      clientLines={[data.contactName, data.contactPhone]}
      columns={{
        description: labels.description,
        qty: labels.qty,
        price: labels.price,
        total: labels.total,
      }}
      items={data.items}
      totals={totals}
      totalsWidth={220}
      tail={
        <>
          {data.validUntil && (
            <Text style={styles.notes}>
              {labels.validUntil} {documentDate(data.validUntil, locale)}
            </Text>
          )}
          {data.notes && <Text style={styles.notes}>{data.notes}</Text>}
          {(data.paymentMethods || data.depositPolicy) && (
            <View style={styles.notes}>
              {data.paymentMethods && (
                <Text>
                  {labels.paymentMethods} {data.paymentMethods}
                </Text>
              )}
              {data.depositPolicy && (
                <Text>
                  {labels.depositPolicy} {data.depositPolicy}
                </Text>
              )}
            </View>
          )}
        </>
      }
      footer={
        <>
          {data.tenantName} · {labels.footer}
        </>
      }
    />
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  const t = await getTranslator(data.locale, "pdf.quote");
  const labels: QuotePdfLabels = {
    title: t("title"),
    client: t("client"),
    description: t("description"),
    qty: t("qty"),
    price: t("price"),
    total: t("total"),
    subtotal: t("subtotal"),
    discount: t("discount"),
    validUntil: t("validUntil"),
    paymentMethods: t("paymentMethods"),
    depositPolicy: t("depositPolicy"),
    footer: t("footer"),
  };

  return renderToBuffer(<QuoteDocument data={data} labels={labels} />);
}
