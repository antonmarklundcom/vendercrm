import { buildCsv } from "@/lib/csv";
import type { PlatformLeadExportRow } from "@/modules/tenancy/platform-crm";

// The cross-account lead export as a CSV file (PLAN.md §19.5 C3). The header
// row is stable English keys, not translated labels: the file is read by
// spreadsheets, scripts and other people, and a column that renames itself
// with the viewer's language breaks every one of those.

export const PLATFORM_LEADS_CSV_COLUMNS = [
  "received_at",
  "account",
  "origin_kind",
  "origin",
  "name",
  "phone",
  "email",
  "message",
  "fields",
  "utm_source",
  "utm_campaign",
  "deal_stage",
  "deal_status",
  "needs_review",
] as const;

/** `key: value`, one field per line inside the one cell. */
function fieldsCell(fields: PlatformLeadExportRow["fields"]): string {
  return fields.map((field) => `${field.key}: ${field.value}`).join("\n");
}

export function platformLeadsCsv(rows: readonly PlatformLeadExportRow[]): string {
  return buildCsv(
    PLATFORM_LEADS_CSV_COLUMNS,
    rows.map((row) => [
      row.receivedAt,
      row.tenantName,
      row.origin.kind,
      row.origin.domain ?? row.origin.name,
      row.name,
      row.phone,
      row.email,
      row.message,
      fieldsCell(row.fields),
      row.utmSource,
      row.utmCampaign,
      row.stageName,
      row.dealStatus,
      row.needsReview.join(" "),
    ]),
  );
}

/** `leads-2026-10-01.csv`, dated in UTC like the timestamps inside. */
export function platformLeadsCsvFilename(now: Date = new Date()): string {
  return `leads-${now.toISOString().slice(0, 10)}.csv`;
}
