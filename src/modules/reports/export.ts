import { toCsv } from "@/modules/crm/export";
import type { SalesReport } from "./sales";

// CSV for each /reports table (PLAN.md §10 1J, §17.3 P15) — the exact same
// `SalesReport` the page renders, so "exportar" always means "what's on
// screen": both read through `getSalesReport` with the same window and
// filters, this just serializes the result differently.

export const REPORT_TABLES = ["agents", "sources", "sites", "stages", "response"] as const;
export type ReportTable = (typeof REPORT_TABLES)[number];

export function isReportTable(value: string | null | undefined): value is ReportTable {
  return !!value && (REPORT_TABLES as readonly string[]).includes(value);
}

/** `userId`/`stageId` resolved to a display name where the caller has one —
 *  the export route passes real names; a name-less caller still gets a
 *  valid file keyed by id. */
export function reportTableToCsv(
  table: ReportTable,
  report: SalesReport,
  names: { users?: Map<string, string> } = {},
): string {
  const userName = (id: string) => names.users?.get(id) ?? id;

  switch (table) {
    case "agents":
      return toCsv(
        ["agente", "leads", "negocios_abiertos", "ganados", "perdidos", "valor_ganado", "respuesta_mediana_min"],
        report.byAgent.map((row) => [
          userName(row.userId),
          row.leads,
          row.dealsOpened,
          row.dealsWon,
          row.dealsLost,
          row.wonValue,
          row.responseMedianMinutes ?? "",
        ]),
      );
    case "sources":
      return toCsv(
        ["origen", "leads", "negocios", "ganados", "valor_ganado"],
        report.bySource.map((row) => [row.key, row.leads, row.deals, row.won, row.wonValue]),
      );
    case "sites":
      return toCsv(
        ["sitio", "leads", "negocios", "ganados", "valor_ganado"],
        report.bySite.map((row) => [row.key, row.leads, row.deals, row.won, row.wonValue]),
      );
    case "stages":
      return toCsv(
        ["etapa", "posicion", "negocios_en_etapa_o_despues"],
        report.stageConversion.map((row) => [row.name, row.position, row.reachedOrPast]),
      );
    case "response":
      return toCsv(
        ["rango", "conversaciones"],
        report.responseDistribution.map((row) => [row.bucket, row.count]),
      );
  }
}
