import { describe, expect, it, vi } from "vitest";
import {
  PLATFORM_CRM_DATE_PRESETS,
  PLATFORM_CRM_MAX_PAGE,
  resolvePlatformCrmRange,
} from "@/modules/tenancy/platform-crm";
import { parsePlatformLeadsParams, platformLeadsHref } from "./filters";

// The constants live in the reader, which imports the db client; nothing here
// reads the database.
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/config/env", () => ({ env: {} }));


const ID_A = "01HZZZZZZZZZZZZZZZZZZZZZZA";
const ID_B = "01HZZZZZZZZZZZZZZZZZZZZZZB";

describe("parsePlatformLeadsParams", () => {
  it("defaults to the leads view, page 1 and no filters", () => {
    const parsed = parsePlatformLeadsParams({});
    expect(parsed.view).toBe("leads");
    expect(parsed.page).toBe(1);
    expect(parsed.filters).toEqual({
      tenantIds: undefined,
      days: undefined,
      from: undefined,
      to: undefined,
      status: undefined,
      source: undefined,
      utmSource: undefined,
      q: undefined,
    });
  });

  it("takes the view from ?view= and ignores unknown tabs", () => {
    expect(parsePlatformLeadsParams({ view: "deals" }).view).toBe("deals");
    expect(parsePlatformLeadsParams({ view: "contacts" }).view).toBe("contacts");
    expect(parsePlatformLeadsParams({ view: "tenants" }).view).toBe("leads");
    expect(parsePlatformLeadsParams({ view: ["deals", "contacts"] }).view).toBe("deals");
  });

  it("accepts every preset from the one constant, and nothing else", () => {
    for (const days of PLATFORM_CRM_DATE_PRESETS) {
      expect(parsePlatformLeadsParams({ days: String(days) }).filters.days).toBe(days);
    }
    for (const bad of ["2", "0", "-7", "7.5", "abc", "1000", "30 OR 1=1"]) {
      expect(parsePlatformLeadsParams({ days: bad }).filters.days).toBeUndefined();
    }
  });

  it("a valid custom range wins over a preset; the reader's default still applies without either", () => {
    const parsed = parsePlatformLeadsParams({ days: "7", from: "2026-09-01", to: "2026-09-15" });
    expect(parsed.filters.from?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(parsed.filters.to?.toISOString()).toBe("2026-09-15T23:59:59.999Z");
    const range = resolvePlatformCrmRange(parsed.filters, new Date("2026-10-01T00:00:00Z"));
    expect(range.days).toBeNull();
    expect(range.since.toISOString()).toBe("2026-09-01T00:00:00.000Z");

    const none = resolvePlatformCrmRange(parsePlatformLeadsParams({}).filters, new Date("2026-10-01T00:00:00Z"));
    expect(none.days).toBe(30);
  });

  it("ignores a custom range with one end, a bad date, or from after to", () => {
    for (const params of [
      { from: "2026-09-01" },
      { to: "2026-09-15" },
      { from: "2026-02-31", to: "2026-03-05" },
      { from: "yesterday", to: "today" },
      { from: "2026-09-15", to: "2026-09-01" },
    ]) {
      const parsed = parsePlatformLeadsParams(params);
      expect(parsed.filters.from).toBeUndefined();
      expect(parsed.filters.to).toBeUndefined();
      expect(parsed.values.from).toBe("");
    }
  });

  it("keeps well-formed account ids (repeated or comma separated) and drops the rest", () => {
    expect(parsePlatformLeadsParams({ tenant: [ID_A, ID_B] }).filters.tenantIds).toEqual([ID_A, ID_B]);
    expect(parsePlatformLeadsParams({ tenant: `${ID_A},${ID_B},${ID_A}` }).filters.tenantIds).toEqual([ID_A, ID_B]);
    expect(parsePlatformLeadsParams({ tenant: ["nope", "' OR 1=1 --", ID_A] }).filters.tenantIds).toEqual([ID_A]);
    expect(parsePlatformLeadsParams({ tenant: "nope" }).filters.tenantIds).toBeUndefined();
  });

  it("accepts open/won/lost only", () => {
    for (const status of ["open", "won", "lost"]) {
      expect(parsePlatformLeadsParams({ status }).filters.status).toBe(status);
    }
    expect(parsePlatformLeadsParams({ status: "pending" }).filters.status).toBeUndefined();
  });

  it("accepts form/booking/chat or site:<id> as the source", () => {
    for (const source of ["form", "booking", "chat", `site:${ID_A}`]) {
      expect(parsePlatformLeadsParams({ source }).filters.source).toBe(source);
    }
    for (const source of ["site:abc", "site:", "email", "SITE:" + ID_A]) {
      expect(parsePlatformLeadsParams({ source }).filters.source).toBeUndefined();
    }
  });

  it("trims and bounds utm_source and the search text", () => {
    const parsed = parsePlatformLeadsParams({ utm: "  google  ", q: "  maría  " });
    expect(parsed.filters.utmSource).toBe("google");
    expect(parsed.filters.q).toBe("maría");
    expect(parsePlatformLeadsParams({ q: "x".repeat(500) }).filters.q).toHaveLength(100);
    expect(parsePlatformLeadsParams({ utm: "   " }).filters.utmSource).toBeUndefined();
  });

  it("clamps the page", () => {
    expect(parsePlatformLeadsParams({ page: "3" }).page).toBe(3);
    expect(parsePlatformLeadsParams({ page: "0" }).page).toBe(1);
    expect(parsePlatformLeadsParams({ page: "-4" }).page).toBe(1);
    expect(parsePlatformLeadsParams({ page: "abc" }).page).toBe(1);
    expect(parsePlatformLeadsParams({ page: "9999" }).page).toBe(PLATFORM_CRM_MAX_PAGE);
  });
});

describe("platformLeadsHref", () => {
  it("rebuilds the link from accepted values only", () => {
    const parsed = parsePlatformLeadsParams({
      view: "deals",
      tenant: [ID_A, "junk"],
      days: "7",
      status: "won",
      bogus: "x",
      page: "2",
    });
    expect(platformLeadsHref(parsed)).toBe(`/platform-leads?view=deals&tenant=${ID_A}&days=7&status=won&page=2`);
    expect(platformLeadsHref(parsed, { view: "leads", page: 1 })).toBe(
      `/platform-leads?tenant=${ID_A}&days=7&status=won`,
    );
    expect(platformLeadsHref(parsePlatformLeadsParams({}))).toBe("/platform-leads");
  });

  it("keeps a custom range instead of the preset", () => {
    const parsed = parsePlatformLeadsParams({ days: "7", from: "2026-09-01", to: "2026-09-15" });
    expect(platformLeadsHref(parsed)).toBe("/platform-leads?from=2026-09-01&to=2026-09-15");
  });
});
