import { beforeEach, describe, expect, it, vi } from "vitest";

// The CSV export route (PLAN.md §19.5 C3). A route handler is not wrapped by
// the (superadmin) layout, so it must refuse a tenant admin and an anonymous
// caller itself, before anything is read or audited — same shape as
// ./authorization.test.ts. The superadmin half checks the route passes the
// page's parsed filters (and never a page) to the reader, returns a CSV
// download, and turns an over-cap refusal into a redirect, never a file.

let session: "none" | "tenantAdmin" | "superadmin" = "none";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () =>
        session === "none"
          ? null
          : {
              user: {
                id: "user-1",
                tenantId: "tenant-1",
                role: "admin",
                isSuperadmin: session === "superadmin",
              },
              session: { impersonatedBy: null },
            },
    },
  },
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/config/env", () => ({ env: {} }));

type ExportResult = Awaited<ReturnType<(typeof import("@/modules/tenancy/platform-crm"))["exportPlatformLeads"]>>;
const okResult = (rows: unknown[] = []) => ({ ok: true, rows, filters: {} }) as unknown as ExportResult;

const reader = {
  listPlatformLeads: vi.fn(),
  listPlatformDeals: vi.fn(),
  listPlatformContacts: vi.fn(),
  getPlatformDeal: vi.fn(),
  exportPlatformLeads: vi.fn(async (): Promise<ExportResult> => okResult()),
};
vi.mock("@/modules/tenancy/platform-crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/tenancy/platform-crm")>()),
  ...reader,
}));
const audit = { writeAuditLog: vi.fn(async () => undefined) };
vi.mock("@/modules/tenancy/audit", () => audit);

const { GET } = await import("./export/route");

const TENANT = "01HZZZZZZZZZZZZZZZZZZZZZZA";
const request = (query = "") => new Request(`http://localhost/platform-leads/export${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  session = "none";
});

describe("platform-leads export authorization", () => {
  for (const caller of ["none", "tenantAdmin"] as const) {
    it(`refuses ${caller === "none" ? "an unauthenticated caller" : "a tenant admin"} with 403, reading and auditing nothing`, async () => {
      session = caller;
      const response = await GET(request(`?tenant=${TENANT}&days=7`));
      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).not.toContain("text/csv");
      expect(response.headers.get("content-disposition")).toBeNull();
      for (const fn of Object.values(reader)) expect(fn).not.toHaveBeenCalled();
      expect(audit.writeAuditLog).not.toHaveBeenCalled();
    });
  }

  it("refuses with 403 when the reader's own superadmin re-check fails", async () => {
    session = "superadmin";
    reader.exportPlatformLeads.mockRejectedValueOnce(new Error("Superadmin required"));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("content-disposition")).toBeNull();
  });
});

describe("platform-leads export for the superadmin", () => {
  beforeEach(() => {
    session = "superadmin";
  });

  it("passes the page's parsed filters to the reader, dropping unknown values, view and page", async () => {
    await GET(
      request(
        `?view=deals&tenant=${TENANT}&tenant=junk&days=7&status=won&source=nope&utm=google&q=mar%C3%ADa&page=3&limit=999999`,
      ),
    );
    expect(reader.exportPlatformLeads).toHaveBeenCalledTimes(1);
    const calls = reader.exportPlatformLeads.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>;
    const [sa, filters] = calls[0];
    expect(sa).toEqual({ userId: "user-1", impersonatorUserId: null });
    expect(filters).toEqual({
      tenantIds: [TENANT],
      days: 7,
      from: undefined,
      to: undefined,
      status: "won",
      source: undefined,
      utmSource: "google",
      q: "maría",
    });
    // The export takes no page or limit at all: there is nothing to widen.
    expect(calls[0]).toHaveLength(2);
    for (const fn of [reader.listPlatformLeads, reader.listPlatformDeals, reader.listPlatformContacts]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("passes a custom range and several accounts", async () => {
    const OTHER = "01HZZZZZZZZZZZZZZZZZZZZZZB";
    await GET(request(`?tenant=${TENANT}&tenant=${OTHER}&from=2026-09-01&to=2026-09-15&source=site:${OTHER}`));
    const calls = reader.exportPlatformLeads.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>;
    expect(calls[0][1]).toMatchObject({
      tenantIds: [TENANT, OTHER],
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-15T23:59:59.999Z"),
      source: `site:${OTHER}`,
    });
  });

  it("returns the rows as an uncached CSV attachment with a dated filename", async () => {
    reader.exportPlatformLeads.mockResolvedValueOnce(
      okResult([
        {
          id: "s1",
          tenantId: TENANT,
          tenantName: "Tasación A",
          tenantStatus: "active",
          receivedAt: new Date("2026-09-30T10:00:00Z"),
          needsReview: ["email_invalid"],
          origin: { kind: "site", name: "Tasación", domain: "tasacion.com.py" },
          contactId: "c1",
          name: "=Ana",
          phone: "+595981123456",
          email: "ana@x",
          message: "Hola, quiero tasar\nmi casa",
          fields: [{ key: "finalidad", value: "Venta" }],
          utmSource: "google",
          utmCampaign: "otoño",
          dealId: "d1",
          dealStatus: "open",
          stageName: "Nuevo",
        },
      ]),
    );
    const response = await GET(request(`?tenant=${TENANT}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="leads-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder().decode(bytes.slice(3));
    expect(body.split("\r\n")[0]).toBe(
      "received_at,account,origin_kind,origin,name,phone,email,message,fields,utm_source,utm_campaign,deal_stage,deal_status,needs_review",
    );
    expect(body).toContain(
      `2026-09-30T10:00:00.000Z,Tasación A,site,tasacion.com.py,'=Ana,'+595981123456,ana@x,"Hola, quiero tasar\nmi casa",finalidad: Venta,google,otoño,Nuevo,open,email_invalid\r\n`,
    );
  });

  it("over the cap: redirects back with the same filters and an error flag, never a file", async () => {
    reader.exportPlatformLeads.mockResolvedValueOnce({
      ok: false,
      reason: "too_many_rows",
      total: 5001,
      max: 5000,
      filters: {},
    } as unknown as ExportResult);
    const response = await GET(request(`?view=deals&tenant=${TENANT}&days=90&q=ana&page=4&bogus=1`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/platform-leads?tenant=${TENANT}&days=90&q=ana&exportError=too_many_rows`,
    );
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.text()).toBe("");
  });
});
