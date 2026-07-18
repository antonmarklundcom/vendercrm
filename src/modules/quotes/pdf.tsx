import * as React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Quote, QuoteItem } from "./service";

// PDF quote template, pure JS rendering (no headless Chrome — required on
// Hostinger, PLAN.md §2.3). Tenant branding comes from tenant.settings
// (brandColor, logoUrl) — logo image rendering is deferred; the brand color
// is applied to headings/totals now.

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  header: { marginBottom: 20 },
  tenantName: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  quoteNumber: { fontSize: 12, color: "#555" },
  section: { marginBottom: 16 },
  label: { fontSize: 9, color: "#888", marginBottom: 2 },
  value: { fontSize: 11 },
  table: { marginTop: 12 },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 6,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: "#333",
    paddingBottom: 6,
    fontWeight: 700,
  },
  colDesc: { flex: 4 },
  colQty: { flex: 1, textAlign: "right" },
  colPrice: { flex: 2, textAlign: "right" },
  colTotal: { flex: 2, textAlign: "right" },
  totals: { marginTop: 16, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  totalLabel: { fontSize: 10, color: "#555" },
  totalValue: { fontSize: 10, width: 100, textAlign: "right" },
  grandTotal: { fontSize: 13, fontWeight: 700 },
  footer: { marginTop: 30, fontSize: 8, color: "#999" },
});

function formatMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString("es-PY")} ${currency}`;
}

export type QuotePdfInput = {
  quote: Quote;
  items: QuoteItem[];
  tenantName: string;
  brandColor?: string;
  contactName: string;
};

function QuoteDocument({
  quote,
  items,
  tenantName,
  brandColor,
  contactName,
}: QuotePdfInput) {
  const accent = brandColor || "#0ea5e9";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={[styles.tenantName, { color: accent }]}>{tenantName}</Text>
          <Text style={styles.quoteNumber}>Presupuesto {quote.number}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Cliente</Text>
          <Text style={styles.value}>{contactName}</Text>
        </View>

        {quote.validUntil && (
          <View style={styles.section}>
            <Text style={styles.label}>Válido hasta</Text>
            <Text style={styles.value}>
              {quote.validUntil.toLocaleDateString("es-PY")}
            </Text>
          </View>
        )}

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDesc}>Descripción</Text>
            <Text style={styles.colQty}>Cant.</Text>
            <Text style={styles.colPrice}>Precio</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>
          {items.map((item) => (
            <View key={item.id} style={styles.tableRow}>
              <Text style={styles.colDesc}>{item.description}</Text>
              <Text style={styles.colQty}>{item.qty}</Text>
              <Text style={styles.colPrice}>
                {formatMoney(item.unitPrice, quote.currency)}
              </Text>
              <Text style={styles.colTotal}>
                {formatMoney(item.lineTotal, quote.currency)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatMoney(quote.subtotal, quote.currency)}
            </Text>
          </View>
          {quote.discount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Descuento</Text>
              <Text style={styles.totalValue}>
                -{formatMoney(quote.discount, quote.currency)}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, styles.grandTotal]}>Total</Text>
            <Text style={[styles.totalValue, styles.grandTotal, { color: accent }]}>
              {formatMoney(quote.total, quote.currency)}
            </Text>
          </View>
        </View>

        {quote.notes && (
          <View style={styles.section}>
            <Text style={styles.label}>Notas</Text>
            <Text style={styles.value}>{quote.notes}</Text>
          </View>
        )}

        <Text style={styles.footer}>
          Documento no fiscal — presupuesto sin valor de factura.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument {...input} />);
}
