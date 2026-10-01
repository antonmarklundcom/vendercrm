import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The cross-account reader's static guards (PLAN.md §19.4): no write path
// besides its audit row, no tenant context, and the shared filter rules. The
// database half is platform-crm.integration.test.ts.
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/config/env", () => ({ env: {} }));

const reader = await import("./platform-crm");
const source = readFileSync(new URL("./platform-crm.ts", import.meta.url), "utf8");

describe("platform-crm.ts has no write path", () => {
  it.each([".insert(", ".update(", ".delete(", "tenantDb(", "buildSystemTenantContext(", "switchActiveTenant("])(
    "never calls %s",
    (needle) => expect(source).not.toContain(needle),
  );

  it("exports only readers, constants and pure helpers", () => {
    const functions = Object.entries(reader)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);
    for (const name of functions) {
      expect(name).toMatch(/^(list|get|count|export|resolve|clamp|preview)/);
    }
  });
});

describe("filters", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const daysBefore = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  it("has the owner's presets and a 30-day default", () => {
    expect(reader.PLATFORM_CRM_DATE_PRESETS).toEqual([1, 7, 30, 90, 180]);
    expect(reader.PLATFORM_CRM_DEFAULT_DAYS).toBe(30);
    expect(reader.PLATFORM_CRM_PAGE_SIZE).toBe(50);
  });

  it("uses a preset, and the default for anything not in the presets", () => {
    expect(reader.resolvePlatformCrmRange({ days: 7 }, now)).toEqual({
      since: daysBefore(7),
      until: now,
      days: 7,
    });
    for (const days of [undefined, 0, 5, 365, -1, Number.NaN]) {
      expect(reader.resolvePlatformCrmRange({ days }, now).days).toBe(30);
    }
  });

  it("takes a custom range, capped at 366 days, and ignores an inverted or invalid one", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(reader.resolvePlatformCrmRange({ from, to: now }, now)).toEqual({ since: from, until: now, days: null });

    const wide = reader.resolvePlatformCrmRange({ from: new Date("2020-01-01T00:00:00Z"), to: now }, now);
    expect(wide.since).toEqual(daysBefore(366));

    expect(reader.resolvePlatformCrmRange({ from: now, to: from }, now).days).toBe(30);
    expect(reader.resolvePlatformCrmRange({ from: new Date("nope"), to: now }, now).days).toBe(30);
  });

  it("clamps the page to 1..200", () => {
    expect(reader.clampPlatformCrmPage(undefined)).toBe(1);
    expect(reader.clampPlatformCrmPage("3")).toBe(3);
    expect(reader.clampPlatformCrmPage(0)).toBe(1);
    expect(reader.clampPlatformCrmPage(2.5)).toBe(1);
    expect(reader.clampPlatformCrmPage(10_000)).toBe(200);
  });

  it("previews the first two customer fields, never the repair metadata", () => {
    expect(
      reader.previewLeadFields({
        _original: { message: "x" },
        name: "Ana",
        finalidad: "Venta",
        turnstile_token: "t",
        ciudad: "Asunción",
        barrio: "Centro",
      }),
    ).toEqual([
      { key: "finalidad", value: "Venta" },
      { key: "ciudad", value: "Asunción" },
    ]);
    expect(reader.previewLeadFields(null)).toEqual([]);
  });
});
