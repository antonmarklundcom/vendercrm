import { intlTag } from "./locales";

// One place where dates and numbers become strings. Before this every page
// carried its own `new Intl.*Format("es-PY", …)`, which made the locale a
// literal in 25 files and quietly meant "Paraguay" even for a Swedish user
// (PLAN.md §13 H5 #5). Timezone and currency are *not* locale-derived: they
// come from the tenant's settings, because a Swedish rep looking at a
// Paraguayan tenant's data still needs Asunción time and guaraníes.

export const DEFAULT_TIMEZONE = "America/Asuncion";

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlTag(locale), options).format(value);
}

/**
 * The app's only money renderer (PLAN.md §14 I2 #1). The UI used to print
 * "1 500 000 PYG" while quotes and notas de venta printed "PYG 1.500.000" —
 * two currency formats in one product, and the UI one invented no fraction
 * digits for currencies that have them.
 *
 * `Intl` currency style settles both: it knows PYG has zero decimals and USD
 * has two, and it puts the code where each locale puts it (Spanish leads
 * with it, Swedish trails it). `currencyDisplay: "code"` rather than a
 * symbol because ₲ and $ are ambiguous next to each other on a quote, and
 * the code is what a Paraguayan invoice carries anyway.
 */
export function formatMoney(value: number, currency: string, locale: string): string {
  const formatted = new Intl.NumberFormat(intlTag(locale), {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(value);
  // Intl separates the code from the amount with a non-breaking space. It
  // renders identically and breaks every exact-match test and grep, so it
  // becomes an ordinary space on the way out.
  return formatted.replace(/\u00a0/g, " ");
}

export function formatDate(
  value: Date | string | number,
  locale: string,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" },
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return new Intl.DateTimeFormat(intlTag(locale), { timeZone, ...options }).format(new Date(value));
}

export function formatDateTime(
  value: Date | string | number,
  locale: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return formatDate(
    value,
    locale,
    { dateStyle: "short", timeStyle: "short" },
    timeZone,
  );
}

export function formatTime(
  value: Date | string | number,
  locale: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return formatDate(value, locale, { hour: "2-digit", minute: "2-digit" }, timeZone);
}
