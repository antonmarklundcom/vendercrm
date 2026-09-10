import { beforeEach, describe, expect, it, vi } from "vitest";

// The Claude Ops console's actions read and write across every tenant —
// every one of them is a POST endpoint reachable by anyone holding a
// session, so the superadmin check has to be on the action itself (§3.2),
// same shape as whatsapp-health/authorization.test.ts and
// tenants/[id]/whatsapp-authorization.test.ts.

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

const ops = {
  createOpsToken: vi.fn(async () => ({ id: "token-1", plaintext: "vc_ops_abc", prefix: "vc_ops_ab" })),
  revokeOpsToken: vi.fn(async () => undefined),
  setOpsTokenAllowlist: vi.fn(async () => undefined),
  listOpsTokens: vi.fn(async () => [
    { id: "token-1", revokedAt: null, createdAt: new Date("2026-01-01") },
  ]),
  getOpsTokenRow: vi.fn(async () => ({ id: "token-1", ownerUserId: "user-1" })),
  createOpsBatch: vi.fn(async () => ({ id: "batch-1", title: "Batch" })),
  setBatchRawText: vi.fn(async () => ({ id: "batch-1" })),
  getOpsRow: vi.fn(async () => ({
    id: "row-1",
    batchId: "batch-1",
    tenantId: "tenant-9",
    siteId: "site-9",
    testContactId: "contact-9",
    testDealId: "deal-9",
    state: "awaiting_approval",
  })),
  markRowLive: vi.fn(async () => undefined),
  markRowRejected: vi.fn(async () => undefined),
  listRowsAwaitingOwner: vi.fn(async () => []),
  retireTestLead: vi.fn(async () => undefined),
};
vi.mock("@/modules/ops", () => ops);

const sites = { updateSite: vi.fn(async () => undefined) };
vi.mock("@/modules/sites/sites", () => sites);

vi.mock("@/modules/tenancy/audit", () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

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

const actions = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  isSuperadmin = false;
});

describe("Claude Ops console actions", () => {
  const cases: Array<{
    name: string;
    call: () => Promise<unknown>;
    service: () => ReturnType<typeof vi.fn>;
  }> = [
    {
      name: "revokeTokenAction",
      call: () => actions.revokeTokenAction(form({ tokenId: "token-1" })),
      service: () => ops.revokeOpsToken,
    },
    {
      name: "setAllowlistAction",
      call: () => actions.setAllowlistAction(form({ tokenId: "token-1", tenantIds: "tenant-2" })),
      service: () => ops.setOpsTokenAllowlist,
    },
    {
      name: "saveBatchTextAction",
      call: () => actions.saveBatchTextAction(form({ batchId: "batch-1", rawText: "x" })),
      service: () => ops.setBatchRawText,
    },
    {
      name: "rejectRowAction",
      call: () => actions.rejectRowAction(form({ rowId: "row-1", note: "missing owner email" })),
      service: () => ops.markRowRejected,
    },
    {
      name: "approveRowAction",
      call: () => actions.approveRowAction(form({ rowId: "row-1" })),
      service: () => ops.markRowLive,
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

  it("refuses a tenant admin — createTokenAction", async () => {
    await expect(
      actions.createTokenAction({ error: null, token: null }, form({ label: "PC" })),
    ).rejects.toThrow();
    expect(ops.createOpsToken).not.toHaveBeenCalled();
  });

  it("creates a token for a superadmin and returns the plaintext once", async () => {
    isSuperadmin = true;
    const result = await actions.createTokenAction(
      { error: null, token: null },
      form({ label: "PC" }),
    );
    expect(ops.createOpsToken).toHaveBeenCalled();
    expect(result.token?.plaintext).toBe("vc_ops_abc");
  });

  it("refuses a tenant admin — createBatchAction", async () => {
    await expect(actions.createBatchAction(form({ title: "Batch" }))).rejects.toThrow();
    expect(ops.createOpsBatch).not.toHaveBeenCalled();
  });

  it("approve activates the site and deletes the test lead", async () => {
    isSuperadmin = true;
    await actions.approveRowAction(form({ rowId: "row-1" }));

    expect(sites.updateSite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-9" }),
      "site-9",
      { isActive: true },
    );
    // Retiring the fixture is one operation now, in the ops module, because
    // the order matters: the lead_submissions row has to go before the deal
    // and the contact are deletable at all.
    expect(ops.retireTestLead).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-9" }),
      { contactId: "contact-9", dealId: "deal-9" },
    );
    expect(ops.markRowLive).toHaveBeenCalledWith("row-1");
  });

  it("approve-all activates every row awaiting the owner", async () => {
    isSuperadmin = true;
    ops.listRowsAwaitingOwner.mockResolvedValueOnce([
      {
        id: "row-a",
        batchId: "batch-1",
        tenantId: "tenant-a",
        siteId: "site-a",
        testContactId: "contact-a",
        testDealId: "deal-a",
        state: "awaiting_approval",
      },
      {
        id: "row-b",
        batchId: "batch-1",
        tenantId: "tenant-b",
        siteId: "site-b",
        testContactId: null,
        testDealId: null,
        state: "awaiting_approval",
      },
      // Already live: activating it again would write a second audit entry
      // for a decision taken once.
      {
        id: "row-c",
        batchId: "batch-1",
        tenantId: "tenant-c",
        siteId: "site-c",
        testContactId: null,
        testDealId: null,
        state: "live",
      },
    ] as never);

    await actions.approveAllRowsAction();

    expect(ops.markRowLive).toHaveBeenCalledWith("row-a");
    expect(ops.markRowLive).toHaveBeenCalledWith("row-b");
    expect(ops.markRowLive).not.toHaveBeenCalledWith("row-c");
  });

  it("refuses a tenant admin — approveAllRowsAction", async () => {
    await expect(actions.approveAllRowsAction()).rejects.toThrow();
    expect(ops.markRowLive).not.toHaveBeenCalled();
  });

  it("reject stores the note", async () => {
    isSuperadmin = true;
    await actions.rejectRowAction(form({ rowId: "row-1", note: "missing owner email" }));
    expect(ops.markRowRejected).toHaveBeenCalledWith("row-1", "missing owner email");
  });
});
