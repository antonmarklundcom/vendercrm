import { describe, expect, it } from "vitest";
import { toCsv } from "./export";

// Pure CSV assembly — no DB. The cases here are the ones that actually
// corrupt a spreadsheet, not hypothetical ones. toCsv delegates to the shared
// lib/csv.ts builder; the routes add the BOM, so none is expected here.

describe("toCsv", () => {
  it("writes a header row and CRLF line endings, every row terminated", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
    expect(toCsv(["a"], [["1"], ["2"]])).toBe("a\r\n1\r\n2\r\n");
  });

  it("adds no BOM (the routes own that)", () => {
    expect(toCsv(["a"], []).charCodeAt(0)).not.toBe(0xfeff);
  });

  it("quotes values containing commas, quotes or newlines", () => {
    expect(toCsv(["x"], [["Gómez, María"]])).toBe('x\r\n"Gómez, María"\r\n');
    expect(toCsv(["x"], [['dijo "hola"']])).toBe('x\r\n"dijo ""hola"""\r\n');
    expect(toCsv(["x"], [["línea1\nlínea2"]])).toBe('x\r\n"línea1\nlínea2"\r\n');
  });

  it("keeps accents and emoji as-is", () => {
    expect(toCsv(["nombre"], [["Ñandú Ávalos 🎉"]])).toBe("nombre\r\nÑandú Ávalos 🎉\r\n");
  });

  it("neutralizes formula injection", () => {
    // A contact named =IMPORTXML(...) must not execute when an admin opens
    // the export in Sheets or Excel.
    expect(toCsv(["x"], [['=IMPORTXML("evil","//x")']])).toContain("'=IMPORTXML");
    for (const prefix of ["=", "+", "-", "@"]) {
      expect(toCsv(["x"], [[`${prefix}test`]])).toBe(`x\r\n'${prefix}test\r\n`);
    }
  });

  it("neutralizes a formula hidden behind a leading tab or newline", () => {
    expect(toCsv(["x"], [["\t=1+1"]])).toBe("x\r\n'\t=1+1\r\n");
    expect(toCsv(["x"], [["\n=1+1"]])).toBe('x\r\n"\'\n=1+1"\r\n');
  });

  it("keeps E.164 phones intact", () => {
    // Without neutralizing the leading +, Sheets evaluates +595981234567 as
    // a number and the phone loses its format — the single most common cell
    // in this product.
    expect(toCsv(["telefono"], [["+595981234567"]])).toBe(
      "telefono\r\n'+595981234567\r\n",
    );
  });

  it("renders empty cells for null and undefined", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,\r\n");
  });

  it("serializes dates as ISO", () => {
    const date = new Date("2026-07-31T12:00:00.000Z");
    expect(toCsv(["creado"], [[date]])).toBe("creado\r\n2026-07-31T12:00:00.000Z\r\n");
  });
});
