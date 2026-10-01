import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every platform-leads page and the "Abrir en la cuenta" action read or move
// across accounts from outside them. A layout is not an authorization
// boundary (§3.3), so each entry point checks the superadmin itself: a tenant
// admin and an unauthenticated caller are refused before anything is read,
// switched or impersonated. Same shape as
// ../tenants/[id]/sites-authorization.test.ts.

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

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => Object.assign((key: string) => key, { raw: () => ({}) }),
  getLocale: async () => "es",
}));

const emptyPage = { rows: [], total: 0, page: 1, pageSize: 50, filters: {} };
const reader = {
  listPlatformLeads: vi.fn(async () => emptyPage),
  listPlatformDeals: vi.fn(async () => emptyPage),
  listPlatformContacts: vi.fn(async () => emptyPage),
  getPlatformDeal: vi.fn(async () => null),
  exportPlatformLeads: vi.fn(async () => ({ ok: true, rows: [], filters: {} })),
};
vi.mock("@/modules/tenancy/platform-crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/tenancy/platform-crm")>()),
  ...reader,
}));
vi.mock("@/modules/tenancy/tenants", () => ({ listTenants: vi.fn(async () => []), getTenant: vi.fn() }));
vi.mock("@/modules/tenancy/console-sites", () => ({ listPlatformSites: vi.fn(async () => []) }));

const memberships = {
  switchActiveTenant: vi.fn(async () => ({ role: "admin" })),
  listMembershipsForTenant: vi.fn(async () => []),
  MembershipError: class MembershipError extends Error {},
};
vi.mock("@/modules/tenancy/memberships", () => memberships);
const impersonation = { startImpersonation: vi.fn(async () => undefined) };
vi.mock("@/modules/auth/impersonation", () => impersonation);
const deals = { getDeal: vi.fn(async () => ({ id: "deal" })) };
vi.mock("@/modules/crm/deals", () => deals);
const audit = { writeAuditLog: vi.fn(async () => undefined) };
vi.mock("@/modules/tenancy/audit", () => audit);
vi.mock("@/modules/tenancy/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/tenancy/context")>()),
  buildSystemTenantContext: vi.fn(async (tenantId: string) => ({ tenantId })),
}));

const listPage = (await import("./page")).default;
const detailPage = (await import("./[tenantId]/deals/[dealId]/page")).default;
const { openInAccountAction } = await import("./actions");

const TENANT = "01HZZZZZZZZZZZZZZZZZZZZZZA";
const DEAL = "01HZZZZZZZZZZZZZZZZZZZZZZD";
const search = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });

const entryPoints: Array<{ name: string; call: () => Promise<unknown> }> = [
  { name: "/platform-leads (leads)", call: () => listPage(search()) },
  { name: "/platform-leads?view=deals", call: () => listPage(search({ view: "deals" })) },
  { name: "/platform-leads?view=contacts", call: () => listPage(search({ view: "contacts" })) },
  {
    name: "/platform-leads/[tenantId]/deals/[dealId]",
    call: () =>
      detailPage({
        params: Promise.resolve({ tenantId: TENANT, dealId: DEAL }),
        searchParams: Promise.resolve({}),
      }),
  },
  { name: "openInAccountAction", call: () => openInAccountAction(TENANT, DEAL) },
];

beforeEach(() => {
  vi.clearAllMocks();
  session = "none";
});

describe("platform-leads authorization", () => {
  for (const { name, call } of entryPoints) {
    for (const caller of ["none", "tenantAdmin"] as const) {
      it(`refuses ${caller === "none" ? "an unauthenticated caller" : "a tenant admin"} — ${name}`, async () => {
        session = caller;
        await expect(call()).rejects.toThrow("Superadmin");
        for (const fn of Object.values(reader)) expect(fn).not.toHaveBeenCalled();
        expect(memberships.switchActiveTenant).not.toHaveBeenCalled();
        expect(impersonation.startImpersonation).not.toHaveBeenCalled();
        expect(deals.getDeal).not.toHaveBeenCalled();
        expect(audit.writeAuditLog).not.toHaveBeenCalled();
      });
    }
  }
});

describe("platform-leads for the superadmin", () => {
  beforeEach(() => {
    session = "superadmin";
  });

  it.each([
    [{}, "listPlatformLeads"],
    [{ view: "leads" }, "listPlatformLeads"],
    [{ view: "deals" }, "listPlatformDeals"],
    [{ view: "contacts" }, "listPlatformContacts"],
    [{ view: "nonsense" }, "listPlatformLeads"],
  ] as const)("renders %j with exactly one reader call (%s), so one view is one audit row", async (params, expected) => {
    await listPage(search(params));
    const called = Object.entries(reader)
      .filter(([name, fn]) => name.startsWith("list") && fn.mock.calls.length > 0)
      .map(([name, fn]) => [name, fn.mock.calls.length]);
    expect(called).toEqual([[expected, 1]]);
    expect(reader.getPlatformDeal).not.toHaveBeenCalled();
  });

  it("passes the parsed filters and page to the reader, dropping unknown values", async () => {
    await listPage(
      search({ days: "7", status: "won", source: "nope", utm: "google", q: "maría", page: "2" }),
    );
    const calls = reader.listPlatformLeads.mock.calls as unknown as Array<[unknown, Record<string, unknown>, number]>;
    const [sa, filters, page] = calls[0];
    expect(sa).toEqual({ userId: "user-1", impersonatorUserId: null });
    expect(filters).toMatchObject({ days: 7, status: "won", utmSource: "google", q: "maría" });
    expect(filters.source).toBeUndefined();
    expect(page).toBe(2);
  });

  it("offers \"Exportar CSV\" on the leads tab only, carrying the accepted filters", async () => {
    const leads = renderToStaticMarkup(
      (await listPage(search({ tenant: TENANT, days: "7", status: "nope", q: "ana", page: "3" }))) as never,
    );
    expect(leads).toContain(`href="/platform-leads/export?tenant=${TENANT}&amp;days=7&amp;q=ana"`);
    expect(leads).toContain("export.button");
    for (const view of ["deals", "contacts"]) {
      const html = renderToStaticMarkup((await listPage(search({ view }))) as never);
      expect(html).not.toContain("/platform-leads/export");
      expect(html).not.toContain("export.button");
    }
    // Rendering the page never runs the export itself.
    expect(reader.exportPlatformLeads).not.toHaveBeenCalled();
  });

  it("shows the over-cap banner only for the export's own error flag", async () => {
    const refused = renderToStaticMarkup(
      (await listPage(search({ exportError: "too_many_rows" }))) as never,
    );
    expect(refused).toContain("export.tooManyRows");
    expect(refused).toContain('role="alert"');
    for (const exportError of ["<script>alert(1)</script>", "other", ""]) {
      const html = renderToStaticMarkup((await listPage(search({ exportError }))) as never);
      expect(html).not.toContain("export.tooManyRows");
      expect(html).not.toContain("<script>alert(1)</script>");
    }
  });

  it("the detail page is notFound() when the reader returns null", async () => {
    await expect(
      detailPage({
        params: Promise.resolve({ tenantId: TENANT, dealId: DEAL }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(reader.getPlatformDeal).toHaveBeenCalledTimes(1);
  });
});
