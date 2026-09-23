import { describe, expect, it } from "vitest";
import { paginate, pageCount, rowsToCsv, sortRows } from "./table-helpers";
import type { TenantTableRow } from "./TenantTable";

function row(overrides: Partial<TenantTableRow>): TenantTableRow {
  return {
    id: "id",
    name: "Negocio",
    slug: "negocio",
    status: "active",
    createdAt: "2024-01-01T00:00:00.000Z",
    sites: [],
    members: 0,
    contacts: 0,
    lastLeadAt: null,
    firstActiveAdminUserId: null,
    ...overrides,
  };
}

describe("sortRows", () => {
  it("sorts by name, case/accent-insensitively, ascending or descending", () => {
    const rows = [row({ id: "b", name: "Zeta" }), row({ id: "a", name: "Alfa" })];
    expect(sortRows(rows, "name", "asc").map((r) => r.id)).toEqual(["a", "b"]);
    expect(sortRows(rows, "name", "desc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts numeric columns", () => {
    const rows = [row({ id: "a", members: 5 }), row({ id: "b", members: 1 })];
    expect(sortRows(rows, "members", "asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("treats a null lastLeadAt as older than any date", () => {
    const rows = [
      row({ id: "with-lead", lastLeadAt: "2024-06-01T00:00:00.000Z" }),
      row({ id: "never", lastLeadAt: null }),
    ];
    expect(sortRows(rows, "lastLead", "asc").map((r) => r.id)).toEqual(["never", "with-lead"]);
  });

  it("is stable: rows that compare equal keep their original order", () => {
    const rows = [row({ id: "1", members: 3 }), row({ id: "2", members: 3 }), row({ id: "3", members: 3 })];
    expect(sortRows(rows, "members", "asc").map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("paginate / pageCount", () => {
  const rows = Array.from({ length: 125 }, (_, i) => row({ id: String(i) }));

  it("slices 50 rows per page", () => {
    expect(paginate(rows, 1, 50)).toHaveLength(50);
    expect(paginate(rows, 3, 50)).toHaveLength(25);
    expect(paginate(rows, 1, 50)[0].id).toBe("0");
    expect(paginate(rows, 2, 50)[0].id).toBe("50");
  });

  it("computes how many pages a total needs, minimum one", () => {
    expect(pageCount(125, 50)).toBe(3);
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
  });
});

describe("rowsToCsv", () => {
  it("starts with a UTF-8 BOM so Excel reads accents correctly", () => {
    const csv = rowsToCsv([row({ name: "Peluquería Ñandutí" })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Peluquería Ñandutí");
  });

  it("joins multiple domains with a space and quotes fields containing a comma", () => {
    const csv = rowsToCsv([
      row({
        name: "Con, coma",
        sites: [
          { domain: "a.com", slug: "a", isActive: true },
          { domain: "b.com", slug: "b", isActive: true },
        ],
      }),
    ]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toContain('"Con, coma"');
    expect(dataLine).toContain("a.com b.com");
  });

  it("includes one header row plus one row per record", () => {
    const csv = rowsToCsv([row({ id: "1" }), row({ id: "2" })]);
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});
