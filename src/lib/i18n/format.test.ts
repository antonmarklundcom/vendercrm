import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatNumber } from "./format";
import { money } from "@/modules/renderable-document/format";
import { intlTag, toSupportedLocale } from "./locales";

describe("locale resolution", () => {
  it("falls back to the reference locale for anything unsupported", () => {
    expect(toSupportedLocale("sv")).toBe("sv");
    expect(toSupportedLocale("pt")).toBe("es");
    expect(toSupportedLocale(undefined)).toBe("es");
  });

  it("keeps Spanish Paraguayan for Intl", () => {
    expect(intlTag("es")).toBe("es-PY");
    expect(intlTag("en")).toBe("en-US");
  });
});

describe("formatters", () => {
  it("groups numbers per locale", () => {
    // Only the separators may differ — the digits never do.
    for (const locale of ["es", "en", "sv"]) {
      expect(formatNumber(1234567, locale).replace(/\D/g, "")).toBe("1234567");
    }
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
  });

  it("keeps the currency code beside the amount", () => {
    expect(formatMoney(50000, "PYG", "es")).toContain("PYG");
  });

  it("renders money the same way everywhere it is printed", () => {
    // One renderer for the UI, the PDFs and the public pages (PLAN.md §14
    // I2 #1) — the document helper is the same function, not a second
    // format that happens to look similar.
    for (const locale of ["es", "en", "sv"]) {
      expect(money(1500000, "PYG", locale)).toBe(formatMoney(1500000, "PYG", locale));
    }
  });

  it("gives each currency the fraction digits it actually has", () => {
    // PYG is a zero-decimal currency; USD is not. The old UI renderer gave
    // both none, so a dollar amount printed as if cents did not exist.
    expect(formatMoney(1500000, "PYG", "es")).toBe("PYG 1.500.000");
    expect(formatMoney(1234.5, "USD", "es")).toBe("USD 1.234,50");
    expect(formatMoney(1234.5, "USD", "en")).toBe("USD 1,234.50");
  });

  it("puts the code where the reader's language puts it", () => {
    expect(formatMoney(50000, "PYG", "sv")).toBe("50 000 PYG");
  });

  it("never leaves a non-breaking space for a caller to trip over", () => {
    for (const locale of ["es", "en", "sv"]) {
      expect(formatMoney(50000, "PYG", locale)).not.toContain("\u00a0");
    }
  });

  it("formats a date in the tenant timezone, not the runtime one", () => {
    // 2026-01-01T02:00:00Z is still 2025-12-31 in Asunción (UTC-3).
    expect(formatDate("2026-01-01T02:00:00.000Z", "es")).toBe("31/12/2025");
  });
});
