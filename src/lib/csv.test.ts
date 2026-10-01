import { describe, expect, it } from "vitest";
import { buildCsv, csvCell, CSV_BOM, neutralizeCsvFormula } from "./csv";

describe("buildCsv", () => {
  it("starts with a UTF-8 BOM and ends rows in CRLF", () => {
    const csv = buildCsv(["a", "b"], [["1", "2"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(CSV_BOM).toBe("﻿");
    expect(csv).toBe("﻿a,b\r\n1,2\r\n");
    // Encoded, the file's first bytes are the EF BB BF byte-order mark.
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("writes only the header row for no rows", () => {
    expect(buildCsv(["a", "b"], [])).toBe("﻿a,b\r\n");
  });
});

describe("csvCell quoting (RFC 4180)", () => {
  it.each([
    ['dice "hola"', '"dice ""hola"""'],
    ["Asunción, Paraguay", '"Asunción, Paraguay"'],
    ["línea 1\nlínea 2", '"línea 1\nlínea 2"'],
    ["línea 1\r\nlínea 2", '"línea 1\r\nlínea 2"'],
    ["fin\r", '"fin\r"'],
  ])("quotes %j", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it("leaves accents and emoji as they are", () => {
    expect(csvCell("María José Ñandutí 🏠")).toBe("María José Ñandutí 🏠");
  });

  it("writes null and undefined as empty, numbers and dates as text", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(new Date("2026-10-01T12:30:00Z"))).toBe("2026-10-01T12:30:00.000Z");
  });

  it("round-trips a row with every special character back into the same cells", () => {
    const cells = ['a "b", c', "x\r\ny", "ñ 😀", "plain"];
    const csv = buildCsv(["h1", "h2", "h3", "h4"], [cells]);
    // The one record between the header's CRLF and the file's final CRLF.
    const record = csv.slice(csv.indexOf("\r\n") + 2, -2);
    expect(parseCsvRecord(record)).toEqual(cells);
  });
});

describe("formula injection", () => {
  it.each([
    ["=HYPERLINK(\"https://evil.example\",\"x\")"],
    ["+595981123456"],
    ["-2+3"],
    ["@SUM(A1:A2)"],
    ["\t=1+1"],
    ["\r=1+1"],
    ["\n=1+1"],
  ])("neutralizes a cell starting %j with a leading apostrophe", (value) => {
    expect(neutralizeCsvFormula(value)).toBe(`'${value}`);
    const cell = csvCell(value);
    // Quoted or not, the first character a spreadsheet reads is the apostrophe.
    expect(cell.replace(/^"/, "")[0]).toBe("'");
  });

  it("keeps a phone readable: only the apostrophe is added", () => {
    expect(csvCell("+595 981 123 456")).toBe("'+595 981 123 456");
  });

  it("neutralizes and quotes together", () => {
    expect(csvCell('=1+1, "x"')).toBe(`"'=1+1, ""x"""`);
  });

  it("neutralizes the header row too", () => {
    expect(buildCsv(["=a"], [])).toBe("﻿'=a\r\n");
  });

  it.each([
    ["Juan Pérez"],
    ["0981 123 456"],
    ["juan@example.com"],
    ["a=b"],
    ["precio: -5"],
    [" =no es fórmula al no empezar con ="],
    [""],
  ])("leaves the safe cell %j untouched", (value) => {
    expect(neutralizeCsvFormula(value)).toBe(value);
    expect(csvCell(value)).toBe(value);
  });
});

/** A minimal RFC 4180 record parser, only for the round-trip assertion above. */
function parseCsvRecord(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}
