import { formatDate, formatMoney } from "@/lib/i18n/format";

// Money and dates as customer-facing documents print them (PLAN.md §13 H9).
// Quotes and notas de venta had a private copy of each of these; SIFEN
// (§9) will need the same again, which is exactly why they live here now.

/**
 * Documents print money exactly as the rest of the app does — this is now
 * one line over `formatMoney` (PLAN.md §14 I2 #1). Kept as a named export so
 * the PDF renderers and public pages keep reading in document vocabulary,
 * and so §9's SIFEN work has the same seam to reach for.
 */
export function money(amount: number, currency: string, locale: string): string {
  return formatMoney(amount, currency, locale);
}

export function documentDate(value: Date, locale: string): string {
  return formatDate(value, locale, { dateStyle: "medium" });
}

/** Per-tenant sequential numbers are zero-padded to six digits — COT-000123,
 * NV-000045 — across every document type (§8, §10 1Q). */
export const SEQUENCE_PAD = 6;

export function formatSequenceNumber(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(SEQUENCE_PAD, "0")}`;
}
