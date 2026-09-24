import { describe, expect, it } from "vitest";
import { computeLineTotals, parseMinorUnits, previewTotals, normalizeAmountInput } from "./money";

// The builders post raw strings and the server recomputes from them (§2.3:
// guaraníes are integer minor units). These guard the one property that
// matters for the preview: it either shows the number the server will store,
// or it shows nothing — never a third number of its own.

describe("parseMinorUnits", () => {
  it("accepts what the server's coercion accepts", () => {
    expect(parseMinorUnits("150000")).toBe(150000);
    expect(parseMinorUnits(" 42 ")).toBe(42);
    expect(parseMinorUnits("0")).toBe(0);
    // Number("") is 0, exactly as z.coerce.number() reads a blank field.
    expect(parseMinorUnits("")).toBe(0);
  });

  it("rejects anything that isn't a whole number", () => {
    // The case that motivated the whole change: a decimal price used to be
    // blocked by the browser before the Spanish message could run.
    expect(parseMinorUnits("150000.5")).toBeNull();
    expect(parseMinorUnits("abc")).toBeNull();
    expect(parseMinorUnits("1,5")).toBeNull();
    expect(parseMinorUnits("9".repeat(20))).toBeNull();
  });
});

describe("previewTotals", () => {
  const line = (over: Partial<{ description: string; qty: string; unitPrice: string }> = {}) => ({
    description: "Consulta",
    qty: "2",
    unitPrice: "150000",
    ...over,
  });

  it("matches what the server computes from the same values", () => {
    const preview = previewTotals([line()], "50000");
    expect(preview).toEqual(
      computeLineTotals([{ productId: undefined, description: "Consulta", qty: 2, unitPrice: 150000 }], 50000),
    );
    expect(preview!.total).toBe(250000);
  });

  it("ignores untouched blank rows, as the server does", () => {
    const preview = previewTotals([line(), line({ description: "  ", qty: "x" })], "0");
    expect(preview!.subtotal).toBe(300000);
  });

  it("returns null rather than a total the server would refuse", () => {
    expect(previewTotals([line({ unitPrice: "150000.5" })], "0")).toBeNull();
    expect(previewTotals([line({ qty: "0" })], "0")).toBeNull();
    expect(previewTotals([line({ qty: "1.5" })], "0")).toBeNull();
    expect(previewTotals([line({ unitPrice: "-1" })], "0")).toBeNull();
    expect(previewTotals([line()], "0.5")).toBeNull();
  });

  it("clamps an over-large discount instead of going negative", () => {
    expect(previewTotals([line({ qty: "1", unitPrice: "1000" })], "5000")!.total).toBe(0);
  });
});

describe("normalizeAmountInput", () => {
  it("reads amounts the way they are written in Paraguay", () => {
    expect(normalizeAmountInput("1.500.000")).toBe("1500000");
    expect(normalizeAmountInput("Gs. 1.500.000")).toBe("1500000");
    expect(normalizeAmountInput("₲ 250 000")).toBe("250000");
    expect(normalizeAmountInput("PYG 12.500")).toBe("12500");
    expect(normalizeAmountInput(" 350000 ")).toBe("350000");
  });

  it("leaves a real fraction alone so it is still rejected", () => {
    expect(normalizeAmountInput("1.5")).toBe("1.5");
    expect(parseMinorUnits("1.5")).toBeNull();
  });

  it("feeds parseMinorUnits, so the builders' previews agree with the server", () => {
    expect(parseMinorUnits("1.500.000")).toBe(1_500_000);
  });
});
