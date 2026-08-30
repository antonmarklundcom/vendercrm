import { describe, expect, it } from "vitest";
import { normalizePhone, waMeHref } from "./phone";

describe("normalizePhone", () => {
  it("passes through numbers that already carry a +", () => {
    expect(normalizePhone("+46701234567", "PY")).toBe("+46701234567");
  });

  it("converts a 00 prefix to +", () => {
    expect(normalizePhone("0046701234567")).toBe("+46701234567");
  });

  it("defaults to Paraguay when no country is given (backward compatible)", () => {
    expect(normalizePhone("0981123456")).toBe("+595981123456");
  });

  it("drops a leading trunk 0 using the given country's dial code", () => {
    expect(normalizePhone("070-123 45 67", "SE")).toBe("+46701234567");
  });

  it("does not mangle a Swedish number as Paraguayan when the tenant default is Sweden", () => {
    // The bug this fixes: a hardcoded PY default would have turned this
    // into "+59570-1234567".
    expect(normalizePhone("0701234567", "SE")).toBe("+46701234567");
    expect(normalizePhone("0701234567", "SE")).not.toContain("595");
  });

  it("adds the country's dial code to a bare local number with no leading 0", () => {
    expect(normalizePhone("981123456", "PY")).toBe("+595981123456");
  });

  it("does not double the dial code when it's already present without a +", () => {
    expect(normalizePhone("595981123456", "PY")).toBe("+595981123456");
  });
});

describe("waMeHref", () => {
  it("builds a bare-digit wa.me link from a stored number", () => {
    expect(waMeHref("+595981123456")).toBe("https://wa.me/595981123456");
  });

  it("normalizes a local number first, so an imported row still reaches someone", () => {
    // "0981 123 456" as typed into a spreadsheet. Linking it verbatim would
    // open a chat with a number that does not exist.
    expect(waMeHref("0981 123 456", "PY")).toBe("https://wa.me/595981123456");
  });

  it("respects the tenant's country rather than assuming Paraguay", () => {
    expect(waMeHref("070-123 45 67", "SE")).toBe("https://wa.me/46701234567");
  });

  it("prefills a message when the view knows what it is about", () => {
    expect(waMeHref("+595981123456", "PY", "Hola, ¿qué tal?")).toBe(
      "https://wa.me/595981123456?text=Hola%2C%20%C2%BFqu%C3%A9%20tal%3F",
    );
  });

  it("returns null for anything that is not dialable, so callers render text", () => {
    expect(waMeHref(null)).toBeNull();
    expect(waMeHref("")).toBeNull();
    expect(waMeHref("123")).toBeNull();
  });
});
