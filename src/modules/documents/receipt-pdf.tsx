// React must be in scope explicitly here — same reason as the other
// document PDFs: this module is reachable from the worker/PDF route, which
// runs through tsx/esbuild and honours tsconfig's `jsx: "preserve"` as the
// classic runtime.
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { TenantBranding } from "@/modules/tenancy/settings";
import type { PaymentMethod } from "./types";
import { getTranslator } from "@/lib/i18n/translator";
import { Text, View } from "@react-pdf/renderer";
import { DocumentShell, styles, type PdfTotalsRow } from "@/modules/renderable-document/pdf";
import { documentDate, money } from "@/modules/renderable-document/format";

// Recibo PDF (PLAN.md §15.2, §15.8 P6) — a receipt for one payment,
// configuring the shared shell (§13 H9) the same way the nota de venta and
// quote PDFs do. One line: what was paid, against which document.

export type ReceiptPdfData = {
  number: string;
  documentNumber: string;
  tenantName: string;
  branding: TenantBranding;
  contactName: string;
  contactPhone: string;
  currency: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paidAt: Date;
  createdAt: Date;
  locale?: string | null;
};

export type ReceiptPdfLabels = {
  title: string;
  client: string;
  description: string;
  total: string;
  againstDocument: string;
  disclaimer: string;
  method: Record<PaymentMethod, string>;
};

export function ReceiptDocument({ data, labels }: { data: ReceiptPdfData; labels: ReceiptPdfLabels }) {
  const locale = data.locale ?? "es";
  const accent = data.branding.primaryColor || "#111111";

  const totals: PdfTotalsRow[] = [
    { label: labels.total, value: money(data.amount, data.currency, locale), kind: "grand", valueColor: accent },
  ];

  return (
    <DocumentShell
      tenantName={data.tenantName}
      branding={data.branding}
      locale={locale}
      currency={data.currency}
      title={labels.title}
      metaLines={[data.number, documentDate(data.paidAt, locale)]}
      clientLabel={labels.client}
      clientLines={[data.contactName, data.contactPhone]}
      clientFooter={`${labels.againstDocument} ${data.documentNumber}`}
      columns={{ description: labels.description, qty: "", price: "", total: labels.total }}
      items={[
        {
          description: `${labels.method[data.method]}${data.reference ? ` · ${data.reference}` : ""}`,
          qty: 1,
          unitPrice: data.amount,
          lineTotal: data.amount,
        },
      ]}
      totals={totals}
      totalsWidth={220}
      tail={
        // Non-fiscal notice, same rule as the nota de venta's own disclaimer:
        // this is not a factura and must say so on its face.
        <View style={styles.disclaimer}>
          <Text>{labels.disclaimer}</Text>
        </View>
      }
      footer={data.tenantName}
    />
  );
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const t = await getTranslator(data.locale, "pdf.recibo");
  const labels: ReceiptPdfLabels = {
    title: t("title"),
    client: t("client"),
    description: t("description"),
    total: t("total"),
    againstDocument: t("againstDocument"),
    disclaimer: t("disclaimer"),
    method: {
      transfer: t("method.transfer"),
      cash: t("method.cash"),
      card: t("method.card"),
      check: t("method.check"),
      other: t("method.other"),
    },
  };

  return renderToBuffer(<ReceiptDocument data={data} labels={labels} />);
}
