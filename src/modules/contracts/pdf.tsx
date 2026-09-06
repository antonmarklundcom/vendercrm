// React must be in scope explicitly here — same reason as the other document
// PDFs: this module is reachable from the worker/PDF route, which runs
// through tsx/esbuild and honours tsconfig's `jsx: "preserve"` as the classic
// runtime.
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { TenantBranding } from "@/modules/tenancy/settings";
import { getTranslator } from "@/lib/i18n/translator";
import { documentDate } from "@/modules/renderable-document/format";
import { parseContractBody, type ContractBlock } from "./render";

// A contract is prose, not line items, so it gets its own layout (§17.3
// P13) rather than the shared `DocumentShell` (table header, item rows,
// totals) every other document reuses — none of that applies here.

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  logo: { width: 120, maxHeight: 48, objectFit: "contain" },
  tenantName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right" },
  meta: { textAlign: "right", color: "#555", marginTop: 4 },
  section: { marginBottom: 16 },
  label: { color: "#666", marginBottom: 2 },
  heading: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  paragraph: { marginBottom: 8, lineHeight: 1.4 },
  noticeBox: {
    marginTop: 20,
    padding: 8,
    borderWidth: 0.5,
    borderColor: "#bbb",
    color: "#555",
    fontSize: 8,
  },
  acceptancePage: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111" },
  acceptanceTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 16 },
  acceptanceRow: { flexDirection: "row", marginBottom: 6 },
  acceptanceLabel: { width: 140, color: "#666" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#999",
    fontSize: 8,
  },
});

export type ContractPdfData = {
  number: string;
  tenantName: string;
  branding: TenantBranding;
  locale?: string | null;
  contactName: string;
  contactPhone: string;
  createdAt: Date;
  body: string;
};

export type ContractPdfLabels = {
  title: string;
  client: string;
  legalNotice: string;
  footer: string;
};

/** Evidence appended to a contract's PDF once it has been decided (§17.3
 *  P13). The original key is never overwritten — this renders a *second*
 *  PDF whose bytes get a second storage key. */
export type ContractAcceptancePageData = {
  decision: "accepted" | "declined";
  nameTyped: string;
  decidedAt: Date;
  ipAddress?: string;
  userAgent?: string;
};

export type ContractAcceptancePageLabels = {
  title: string;
  decisionLabel: string;
  decisionValues: { accepted: string; declined: string };
  nameLabel: string;
  dateLabel: string;
  ipLabel: string;
  userAgentLabel: string;
};

function Blocks({ blocks }: { blocks: ContractBlock[] }) {
  return (
    <>
      {blocks.map((block, index) =>
        block.type === "heading" ? (
          <Text key={index} style={styles.heading}>
            {block.text}
          </Text>
        ) : (
          <Text key={index} style={styles.paragraph}>
            {block.text}
          </Text>
        ),
      )}
    </>
  );
}

export function ContractDocument({
  data,
  labels,
  acceptance,
  acceptanceLabels,
}: {
  data: ContractPdfData;
  labels: ContractPdfLabels;
  acceptance?: ContractAcceptancePageData;
  acceptanceLabels?: ContractAcceptancePageLabels;
}) {
  const locale = data.locale ?? "es";
  const accent = data.branding.primaryColor || "#111111";
  const blocks = parseContractBody(data.body);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {data.branding.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt prop
              <Image style={styles.logo} src={data.branding.logoUrl} />
            ) : (
              <Text style={[styles.tenantName, { color: accent }]}>{data.tenantName}</Text>
            )}
          </View>
          <View>
            <Text style={[styles.title, { color: accent }]}>{labels.title}</Text>
            <Text style={styles.meta}>{data.number}</Text>
            <Text style={styles.meta}>{documentDate(data.createdAt, locale)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{labels.client}</Text>
          <Text>{data.contactName}</Text>
          <Text>{data.contactPhone}</Text>
        </View>

        <Blocks blocks={blocks} />

        <View style={styles.noticeBox}>
          <Text>{labels.legalNotice}</Text>
        </View>

        <Text style={styles.footer}>{labels.footer}</Text>
      </Page>

      {acceptance && acceptanceLabels && (
        <Page size="A4" style={styles.acceptancePage}>
          <Text style={styles.acceptanceTitle}>{acceptanceLabels.title}</Text>
          <View style={styles.acceptanceRow}>
            <Text style={styles.acceptanceLabel}>{acceptanceLabels.decisionLabel}</Text>
            <Text>{acceptanceLabels.decisionValues[acceptance.decision]}</Text>
          </View>
          <View style={styles.acceptanceRow}>
            <Text style={styles.acceptanceLabel}>{acceptanceLabels.nameLabel}</Text>
            <Text>{acceptance.nameTyped}</Text>
          </View>
          <View style={styles.acceptanceRow}>
            <Text style={styles.acceptanceLabel}>{acceptanceLabels.dateLabel}</Text>
            <Text>{documentDate(acceptance.decidedAt, locale)}</Text>
          </View>
          {acceptance.ipAddress && (
            <View style={styles.acceptanceRow}>
              <Text style={styles.acceptanceLabel}>{acceptanceLabels.ipLabel}</Text>
              <Text>{acceptance.ipAddress}</Text>
            </View>
          )}
          {acceptance.userAgent && (
            <View style={styles.acceptanceRow}>
              <Text style={styles.acceptanceLabel}>{acceptanceLabels.userAgentLabel}</Text>
              <Text>{acceptance.userAgent}</Text>
            </View>
          )}
        </Page>
      )}
    </Document>
  );
}

export async function renderContractPdf(
  data: ContractPdfData,
  acceptance?: ContractAcceptancePageData,
): Promise<Buffer> {
  const t = await getTranslator(data.locale, "pdf.contract");
  const labels: ContractPdfLabels = {
    title: t("title"),
    client: t("client"),
    legalNotice: t("legalNotice"),
    footer: t("footer"),
  };

  const acceptanceLabels: ContractAcceptancePageLabels | undefined = acceptance
    ? {
        title: t("acceptancePageTitle"),
        decisionLabel: t("decisionLabel"),
        decisionValues: { accepted: t("decisionValues.accepted"), declined: t("decisionValues.declined") },
        nameLabel: t("nameLabel"),
        dateLabel: t("dateLabel"),
        ipLabel: t("ipLabel"),
        userAgentLabel: t("userAgentLabel"),
      }
    : undefined;

  return renderToBuffer(
    <ContractDocument data={data} labels={labels} acceptance={acceptance} acceptanceLabels={acceptanceLabels} />,
  );
}
