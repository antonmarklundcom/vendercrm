import { describe, expect, it } from "vitest";
import { monthlyPrice, parseOverviewWindow } from "./platform-stats";

// Plans are prepaid for 3, 6 or 12 months (schema/tenancy.ts); the overview
// page's "expected monthly revenue" number depends entirely on this
// normalisation being right, not on any database state, so it gets its own
// unit test rather than only living inside the integration suite.
describe("monthlyPrice", () => {
  it("divides a monthly plan's price by 1 (itself)", () => {
    expect(monthlyPrice(100_000, 1)).toBe(100_000);
  });

  it("divides a quarterly plan's price by 3", () => {
    expect(monthlyPrice(300_000, 3)).toBe(100_000);
  });

  it("divides a semiannual plan's price by 6", () => {
    expect(monthlyPrice(900_000, 6)).toBe(150_000);
  });

  it("divides an annual plan's price by 12", () => {
    expect(monthlyPrice(1_200_000, 12)).toBe(100_000);
  });

  it("does not round on its own — callers round the summed total, not each plan", () => {
    expect(monthlyPrice(100_000, 3)).toBeCloseTo(33_333.33, 2);
  });
});

describe("parseOverviewWindow", () => {
  it("accepts the offered windows", () => {
    expect(parseOverviewWindow("7")).toBe(7);
    expect(parseOverviewWindow("90")).toBe(90);
  });

  it("falls back to 30 days for anything else", () => {
    expect(parseOverviewWindow(undefined)).toBe(30);
    expect(parseOverviewWindow("365")).toBe(30);
    expect(parseOverviewWindow("abc")).toBe(30);
  });
});
