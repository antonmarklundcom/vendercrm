// React must be in scope explicitly here — same reason as the quote PDF:
// this module is reachable from the worker entry, which runs through
// tsx/esbuild and honours tsconfig's `jsx: "preserve"` as the classic
// runtime.
import React from "react";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { TenantBranding } from "@/modules/tenancy/settings";
import type { PaymentState } from "./types";
import { getTranslator } from "@/lib/i18n/translator";
import {
  DocumentShell,
  styles,
  type PdfLineItem,
  type PdfTotalsRow,
} from "@/modules/renderable-document/pdf";
import { documentDate, money } from "@/modules/renderable-document/format";

// Nota de venta PDF (PLAN.md §10 1Q), now a configuration of the shared
// document shell (§13 H9) rather than its own copy of the layout. What is
// left here is what makes a nota de venta itself: the payment stamp, the
// paid/balance rows, and the disclaimer.
//
// The legal disclaimer in the footer is not decoration. This document is not
// a factura and carries no timbrado, so it must say so on its face — a
// customer who files it as a tax document has a problem, and the cheapest
// place to prevent that is the page itself.
export type DocumentPdfData = {
  number: string;
  tenantName: string;
  branding: TenantBranding;
  contactName: string;
  contactPhone: string;
  currency: string;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  balance: number;
  state: PaymentState;
  dueAt: Date | null;
  issuedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  items: PdfLineItem[];
  /** The **tenant's** locale — this is read by their customer, not by
   * whoever pressed send (PLAN.md §13 H5 #4). */
  locale?: string | null;
  /** From the memory (K3, PLAN.md §16.4) — printed only when the tenant has
   *  confirmed them, same as everywhere else the memory reaches a customer. */
  paymentMethods?: string | null;
  depositPolicy?: string | null;
};

// PYG has no decimal places (§2.3), so amounts are whole guaraníes and the
// thousands separator is the only formatting needed.
/** Resolved by renderDocumentPdf: the react-pdf tree renders synchronously
 * and can't await a translator itself. The disclaimer is not decoration —
 * this document is not a factura and must say so on its face, in whatever
 * language the customer reads. */
export type DocumentPdfLabels = {
  title: string;
  client: string;
  dueAt: string;
  description: string;
  qty: string;
  price: string;
  total: string;
  subtotal: string;
  discount: string;
  paid: string;
  balance: string;
  notes: string;
  disclaimer: string;
  paymentMethods: string;
  depositPolicy: string;
  state: Record<PaymentState, string>;
};

const STATE_COLOR: Record<PaymentState, string> = {
  unpaid: "#b45309",
  partial: "#b45309",
  paid: "#15803d",
  void: "#b91c1c",
};

export function NotaVentaDocument({
  data,
  labels,
}: {
  data: DocumentPdfData;
  labels: DocumentPdfLabels;
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
    ...(data.amountPaid > 0
      ? [{ label: labels.paid, value: `-${money(data.amountPaid, data.currency, locale)}` }]
      : []),
    {
      label: labels.balance,
      value: money(data.balance, data.currency, locale),
      kind: "balance" as const,
      valueColor: STATE_COLOR[data.state],
    },
  ];

  return (
    <DocumentShell
      tenantName={data.tenantName}
      branding={data.branding}
      locale={locale}
      currency={data.currency}
      title={labels.title}
      metaLines={[data.number, documentDate(data.issuedAt ?? data.createdAt, locale)]}
      stamp={{ text: labels.state[data.state], color: STATE_COLOR[data.state] }}
      clientLabel={labels.client}
      clientLines={[data.contactName, data.contactPhone]}
      clientFooter={
        data.dueAt ? (
          <>
            {labels.dueAt} {documentDate(data.dueAt, locale)}
          </>
        ) : undefined
      }
      columns={{
        description: labels.description,
        qty: labels.qty,
        price: labels.price,
        total: labels.total,
      }}
      items={data.items}
      totals={totals}
      tail={
        <>
          {data.notes && (
            <View style={styles.notes}>
              <Text style={styles.label}>{labels.notes}</Text>
              <Text>{data.notes}</Text>
            </View>
          )}

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

          {/* The legal disclaimer is not decoration: this document is not a
              factura and carries no timbrado, so it must say so on its face
              — a customer who files it as a tax document has a problem, and
              the cheapest place to prevent that is the page itself. */}
          <View style={styles.disclaimer}>
            <Text>{labels.disclaimer}</Text>
          </View>
        </>
      }
      footer={data.tenantName}
    />
  );
}

export async function renderDocumentPdf(data: DocumentPdfData): Promise<Buffer> {
  const t = await getTranslator(data.locale, "pdf.notaVenta");
  const labels: DocumentPdfLabels = {
    title: t("title"),
    client: t("client"),
    dueAt: t("dueAt"),
    description: t("description"),
    qty: t("qty"),
    price: t("price"),
    total: t("total"),
    subtotal: t("subtotal"),
    discount: t("discount"),
    paid: t("paid"),
    balance: t("balance"),
    notes: t("notes"),
    disclaimer: t("disclaimer"),
    paymentMethods: t("paymentMethods"),
    depositPolicy: t("depositPolicy"),
    state: {
      unpaid: t("state.unpaid"),
      partial: t("state.partial"),
      paid: t("state.paid"),
      void: t("state.void"),
    },
  };

  return renderToBuffer(<NotaVentaDocument data={data} labels={labels} />);
}
