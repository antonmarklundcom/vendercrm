import { describe, expect, it } from "vitest";
import { resolveTenantRefs } from "./tenant-refs";

// Pure resolver behind the Claude Ops allowlist form. No DB: the console
// action passes the tenant list in. The case it exists for: on 2026-09-10
// the owner typed business names, they were stored verbatim as "ids", the
// console echoed them back as if allowlisted, and `/me` saw nothing.

const tenants = [
  { id: "01M08QG7C0ZE8HHK826MGABV1V", name: "Tasacion", slug: "tasacion" },
  { id: "01M08QG7C0ZE8HHK826MGABV2W", name: "Sitiosweb.com.py", slug: "sitiosweb" },
  { id: "01M08QG7C0ZE8HHK826MGABV3X", name: "Medico", slug: "medico" },
];

describe("resolveTenantRefs", () => {
  it("accepts an id, a slug or a name, case-insensitively, and returns ids", () => {
    const result = resolveTenantRefs(
      ["01M08QG7C0ZE8HHK826MGABV1V", " SITIOSWEB ", "medico"],
      tenants,
    );
    expect(result.unknown).toEqual([]);
    expect(result.ids).toEqual([
      "01M08QG7C0ZE8HHK826MGABV1V",
      "01M08QG7C0ZE8HHK826MGABV2W",
      "01M08QG7C0ZE8HHK826MGABV3X",
    ]);
  });

  it("reports every entry that matches nothing, so the caller refuses the save", () => {
    const result = resolveTenantRefs(["Tasacion", "Gruas", "01NOPE"], tenants);
    expect(result.ids).toEqual(["01M08QG7C0ZE8HHK826MGABV1V"]);
    expect(result.unknown).toEqual(["Gruas", "01NOPE"]);
  });

  it("de-duplicates and ignores blanks", () => {
    const result = resolveTenantRefs(["tasacion", "", "Tasacion", "01M08QG7C0ZE8HHK826MGABV1V"], tenants);
    expect(result).toEqual({ ids: ["01M08QG7C0ZE8HHK826MGABV1V"], unknown: [] });
  });

  it("prefers an exact id over a name that happens to look like one", () => {
    const tricky = [...tenants, { id: "01ZZZ", name: "01M08QG7C0ZE8HHK826MGABV1V", slug: "weird" }];
    const result = resolveTenantRefs(["01M08QG7C0ZE8HHK826MGABV1V"], tricky);
    expect(result.ids).toEqual(["01M08QG7C0ZE8HHK826MGABV1V"]);
  });
});
