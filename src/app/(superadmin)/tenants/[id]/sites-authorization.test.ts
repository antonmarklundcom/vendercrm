import { beforeEach, describe, expect, it, vi } from "vitest";

// The console's site actions — the business page's (sites-actions.ts) and
// /platform-sites' bulk keys — reach into any tenant from outside it. Each is
// a POST endpoint anyone with a session can hit, so the superadmin check has
// to be on the action itself (§3.2). Same shape as
// whatsapp-authorization.test.ts next door.

let isSuperadmin = false;

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "user-1", tenantId: "tenant-1", role: "admin", isSuperadmin },
        session: { impersonatedBy: null },
      }),
    },
  },
}));

const site = { id: "site-1", slug: "gruas", domain: "gruas.com.py", isActive: false };
const sites = {
  createSite: vi.fn(async () => ({ id: "site-2", apiKey: "vc_live_x" })),
  getSite: vi.fn(async () => site),
  getSiteBySlug: vi.fn(async () => null),
  updateSite: vi.fn(async () => undefined),
};
vi.mock("@/modules/sites/sites", () => sites);

const keys = {
  issueApiKey: vi.fn(async () => ({ ok: true, plaintext: "vc_live_y", keyId: "key-2" })),
  revokeApiKey: vi.fn(async () => undefined),
  listActiveApiKeys: vi.fn(async () => []),
};
vi.mock("@/modules/sites/keys", () => keys);

const ingest = {
  ingestLeadForSite: vi.fn(async () => ({
    ok: true,
    result: { contactId: "contact-1", dealId: "deal-1", submissionId: "s-1", duplicate: false },
  })),
};
vi.mock("@/modules/sites/ingest", () => ingest);

vi.mock("@/modules/crm/pipelines", () => ({
  listPipelines: vi.fn(async () => [{ id: "pipe-1" }]),
  listStagesForPipeline: vi.fn(async () => [{ id: "stage-1" }]),
  getStage: vi.fn(async () => ({ id: "stage-1", pipelineId: "pipe-1" })),
}));
vi.mock("@/modules/crm/contacts", () => ({
  getContact: vi.fn(async () => ({ id: "contact-1", name: "Prueba desde la consola" })),
}));
vi.mock("@/modules/tenancy/users", () => ({ listUsersForTenant: vi.fn(async () => []) }));
vi.mock("@/modules/whatsapp/accounts", () => ({ getAccount: vi.fn(async () => null) }));

const ops = {
  listRowsAwaitingOwner: vi.fn(async () => []),
  markRowLive: vi.fn(async () => undefined),
  retireTestLead: vi.fn(async () => undefined),
};
vi.mock("@/modules/ops", () => ops);
vi.mock("@/modules/ops/provision", () => ({ slugFromDomain: () => "gruas" }));

vi.mock("@/modules/tenancy/console-sites", () => ({
  resolveSiteTenants: vi.fn(async () => [
    { siteId: "site-1", tenantId: "tenant-9", domain: "gruas.com.py", slug: "gruas", tenantName: "Gruas" },
  ]),
}));

vi.mock("@/modules/tenancy/audit", () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/tenancy/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/tenancy/context")>()),
  buildSystemTenantContext: async (tenantId: string) => ({
    tenantId,
    userId: "system",
    role: "agent" as const,
    impersonatorUserId: null,
    accessStatus: "active" as const,
  }),
}));

const siteActions = await import("./sites-actions");
const platformActions = await import("../../platform-sites/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const keyState = { error: null, apiKey: null, siteId: null };
const ref = { tenantId: "tenant-9", siteId: "site-1" };

beforeEach(() => {
  vi.clearAllMocks();
  isSuperadmin = false;
});

describe("console site actions", () => {
  const cases: Array<{
    name: string;
    call: () => Promise<unknown>;
    service: () => ReturnType<typeof vi.fn>;
  }> = [
    {
      name: "createTenantSiteAction",
      call: () =>
        siteActions.createTenantSiteAction(keyState, form({ tenantId: "tenant-9", domain: "gruas.com.py" })),
      service: () => sites.createSite,
    },
    {
      name: "issueTenantSiteKeyAction",
      call: () => siteActions.issueTenantSiteKeyAction(keyState, form(ref)),
      service: () => keys.issueApiKey,
    },
    {
      name: "revokeTenantSiteKeyAction",
      call: () => siteActions.revokeTenantSiteKeyAction(form({ ...ref, keyId: "key-1" })),
      service: () => keys.revokeApiKey,
    },
    {
      name: "setTenantSiteActiveAction",
      call: () => siteActions.setTenantSiteActiveAction(form({ ...ref, active: "true" })),
      service: () => sites.updateSite,
    },
    {
      name: "sendTestLeadAction",
      call: () =>
        siteActions.sendTestLeadAction({ siteId: null, error: null, lead: null }, form(ref)),
      service: () => ingest.ingestLeadForSite,
    },
    {
      name: "retireTestLeadAction",
      call: () =>
        siteActions.retireTestLeadAction(
          form({ tenantId: "tenant-9", contactId: "contact-1", dealId: "deal-1" }),
        ),
      service: () => ops.retireTestLead,
    },
    {
      name: "updateTenantSiteAction",
      call: () =>
        siteActions.updateTenantSiteAction(
          { error: null, saved: false },
          form({ ...ref, name: "Gruas", stageId: "stage-1" }),
        ),
      service: () => sites.updateSite,
    },
    {
      name: "issueKeysForSitesAction",
      call: () =>
        platformActions.issueKeysForSitesAction({ error: null, keys: [] }, form({ siteId: "site-1" })),
      service: () => keys.issueApiKey,
    },
  ];

  for (const { name, call, service } of cases) {
    it(`refuses a tenant admin — ${name}`, async () => {
      await expect(call()).rejects.toThrow();
      expect(service()).not.toHaveBeenCalled();
    });

    it(`runs for a superadmin — ${name}`, async () => {
      isSuperadmin = true;
      await call();
      expect(service()).toHaveBeenCalled();
    });
  }

  it("the test lead never touches the site's health", async () => {
    isSuperadmin = true;
    await siteActions.sendTestLeadAction({ siteId: null, error: null, lead: null }, form(ref));
    expect(ingest.ingestLeadForSite).toHaveBeenCalledWith(
      site,
      expect.anything(),
      {},
      "key",
      { allowInactive: true, skipHealth: true },
    );
  });

  it("refuses to retire a contact that is not a console test lead", async () => {
    isSuperadmin = true;
    const contacts = await import("@/modules/crm/contacts");
    vi.mocked(contacts.getContact).mockResolvedValueOnce({ id: "c", name: "Cliente real" } as never);
    const retired = await siteActions.retireTestLeadAction(
      form({ tenantId: "tenant-9", contactId: "c" }),
    );
    expect(retired).toBe(false);
    expect(ops.retireTestLead).not.toHaveBeenCalled();
  });

  it("bulk keys revoke the old ones only when asked to replace", async () => {
    isSuperadmin = true;
    keys.listActiveApiKeys.mockResolvedValue([{ id: "old-key" }] as never);
    await platformActions.issueKeysForSitesAction({ error: null, keys: [] }, form({ siteId: "site-1" }));
    expect(keys.revokeApiKey).not.toHaveBeenCalled();

    await platformActions.issueKeysForSitesAction(
      { error: null, keys: [] },
      form({ siteId: "site-1", replace: "on" }),
    );
    expect(keys.revokeApiKey).toHaveBeenCalledWith(expect.anything(), "site-1", "old-key");
  });
});
