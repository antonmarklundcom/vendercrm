// CSV for files a person opens in Excel or Google Sheets (PLAN.md §19.5 C3).
//
// Pure and dependency-free, in lib/ for the same reason lib/money.ts and
// lib/sql-like.ts are: it is unit-tested without an environment or a
// database. Three rules, all applied to every cell:
//
// 1. Formula injection is neutralized. A cell whose first character is `=`,
//    `+`, `-` or `@` (or a tab, CR or LF, which spreadsheets skip before
//    looking for one) is run as a formula when the file is opened — a lead
//    named `=HYPERLINK("https://evil", "x")` would otherwise execute on the
//    superadmin's machine. Such a cell gets a leading apostrophe, the
//    standard "this is text" marker (OWASP "CSV Injection"). That includes
//    E.164 phones: `+595981123456` is exported as `'+595981123456`, which
//    Sheets displays without the apostrophe and Excel shows with it — still
//    readable, and it keeps the `+` instead of turning the number into
//    595981123456. Accepted on purpose; there is no per-column exception.
// 2. RFC 4180 quoting: a cell holding a quote, comma, CR or LF is wrapped in
//    double quotes with inner quotes doubled; rows end in CRLF.
// 3. UTF-8 with a byte-order mark, so Excel opens accents and emoji
//    correctly instead of guessing a legacy code page.

export const CSV_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r\n]/;

/** Prefixes `'` to a value a spreadsheet would read as a formula. */
export function neutralizeCsvFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One cell: null/undefined → empty, Date → ISO 8601 UTC, then neutralized and quoted. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const safe = neutralizeCsvFormula(raw);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** A whole file: BOM, the header row, then the rows, CRLF-separated. */
export function buildCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return CSV_BOM + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
