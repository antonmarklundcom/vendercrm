import { beforeEach, describe, expect, it, vi } from "vitest";

// "Abrir en la cuenta" (PLAN.md §19.4, Link-through), against in-memory
// stand-ins for the membership and deal reads. The real tables are exercised
// by open-in-account.integration.test.ts.

const TENANT_A = "01HZZZZZZZZZZZZZZZZZZZZZZA";
const TENANT_B = "01HZZZZZZZZZZZZZZZZZZZZZZB";
const DEAL_A = "01HZZZZZZZZZZZZZZZZZZZZZ0A";
const DEAL_B = "01HZZZZZZZZZZZZZZZZZZZZZ0B";
const MISSING = "01HZZZZZZZZZZZZZZZZZZZZZ00";

const state = vi.hoisted(() => ({
  memberOf: new Set<string>(),
  active: null as string | null,
  dealsByTenant: new Map<string, Set<string>>(),
  admins: [] as Array<{
    membership: { role: string; banned: boolean; createdAt: Date };
    user: { id: string; banned: boolean; isSuperadmin: boolean };
  }>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "sa-1", tenantId: null, isSuperadmin: true },
        session: { impersonatedBy: null },
      }),
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

vi.mock("@/modules/tenancy/memberships", () => {
  class MembershipError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    MembershipError,
    switchActiveTenant: vi.fn(async (_userId: string, tenantId: string) => {
      if (!state.memberOf.has(tenantId)) throw new MembershipError("notFound");
      state.active = tenantId;
      return { role: "admin" };
    }),
    listMembershipsForTenant: vi.fn(async () => state.admins),
  };
});
const impersonation = { startImpersonation: vi.fn(async () => undefined) };
vi.mock("@/modules/auth/impersonation", () => impersonation);
vi.mock("@/modules/crm/deals", () => ({
  getDeal: vi.fn(async (ctx: { tenantId: string }, id: string) =>
    state.dealsByTenant.get(ctx.tenantId)?.has(id) ? { id } : null,
  ),
}));
const audit = { writeAuditLog: vi.fn(async () => undefined) };
vi.mock("@/modules/tenancy/audit", () => audit);
vi.mock("@/modules/tenancy/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/tenancy/context")>()),
  buildSystemTenantContext: vi.fn(async (tenantId: string) => ({ tenantId })),
}));

const memberships = await import("@/modules/tenancy/memberships");
const { openInAccountAction } = await import("./actions");

const outcome = async (tenantId: string, dealId: string) => {
  try {
    await openInAccountAction(tenantId, dealId);
    return "returned";
  } catch (err) {
    return (err as Error).message;
  }
};

const admin = (id: string, createdAt: string, extra: Partial<(typeof state.admins)[number]["user"]> = {}) => ({
  membership: { role: "admin", banned: false, createdAt: new Date(createdAt) },
  user: { id, banned: false, isSuperadmin: false, ...extra },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.memberOf = new Set();
  state.active = null;
  state.dealsByTenant = new Map([
    [TENANT_A, new Set([DEAL_A])],
    [TENANT_B, new Set([DEAL_B])],
  ]);
  state.admins = [];
});

describe("openInAccountAction with a live membership", () => {
  beforeEach(() => {
    state.memberOf = new Set([TENANT_A]);
  });

  it("switches, confirms the deal in that account and lands on its pipeline page", async () => {
    expect(await outcome(TENANT_A, DEAL_A)).toBe(`NEXT_REDIRECT:/pipeline/${DEAL_A}`);
    expect(state.active).toBe(TENANT_A);
    expect(impersonation.startImpersonation).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        actorUserId: "sa-1",
        action: "platform.deal.opened_in_account",
        payload: { tenantId: TENANT_A, dealId: DEAL_A, via: "membership" },
      }),
    );
  });

  it("a deal id of another account ends on the same not-found as a nonexistent id", async () => {
    const foreign = await outcome(TENANT_A, DEAL_B);
    const missing = await outcome(TENANT_A, MISSING);
    expect(foreign).toBe("NEXT_NOT_FOUND");
    expect(foreign).toBe(missing);
    expect(impersonation.startImpersonation).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses malformed ids before touching anything", async () => {
    expect(await outcome("../../etc", DEAL_A)).toBe("NEXT_NOT_FOUND");
    expect(await outcome(TENANT_A, "x/../y")).toBe("NEXT_NOT_FOUND");
    expect(memberships.switchActiveTenant).not.toHaveBeenCalled();
  });
});

describe("openInAccountAction without a membership", () => {
  it("does not switch; it falls back to 'ver como' on the oldest active admin", async () => {
    state.admins = [
      admin("late-admin", "2026-03-01"),
      admin("banned-admin", "2025-01-01", { banned: true }),
      admin("early-admin", "2025-06-01"),
    ];
    expect(await outcome(TENANT_B, DEAL_B)).toBe(`NEXT_REDIRECT:/pipeline/${DEAL_B}`);
    expect(state.active).toBeNull();
    expect(impersonation.startImpersonation).toHaveBeenCalledWith("early-admin", TENANT_B);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "platform.deal.opened_in_account",
        payload: { tenantId: TENANT_B, dealId: DEAL_B, via: "impersonation" },
      }),
    );
  });

  it("never impersonates a superadmin or a deactivated membership", async () => {
    state.admins = [
      admin("another-sa", "2025-01-01", { isSuperadmin: true }),
      { ...admin("banned-member", "2025-01-02"), membership: { role: "admin", banned: true, createdAt: new Date() } },
      { ...admin("agent", "2025-01-03"), membership: { role: "agent", banned: false, createdAt: new Date() } },
    ];
    expect(await outcome(TENANT_B, DEAL_B)).toBe(
      `NEXT_REDIRECT:/platform-leads/${TENANT_B}/deals/${DEAL_B}?openError=1`,
    );
    expect(impersonation.startImpersonation).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it("a deal id of another account is the same not-found, and nobody is impersonated", async () => {
    state.admins = [admin("early-admin", "2025-06-01")];
    const foreign = await outcome(TENANT_B, DEAL_A);
    expect(foreign).toBe("NEXT_NOT_FOUND");
    expect(foreign).toBe(await outcome(TENANT_B, MISSING));
    expect(impersonation.startImpersonation).not.toHaveBeenCalled();
  });

  it("goes back to the detail page if the impersonation is refused", async () => {
    state.admins = [admin("early-admin", "2025-06-01")];
    impersonation.startImpersonation.mockRejectedValueOnce(new Error("refused"));
    expect(await outcome(TENANT_B, DEAL_B)).toBe(
      `NEXT_REDIRECT:/platform-leads/${TENANT_B}/deals/${DEAL_B}?openError=1`,
    );
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });
});
