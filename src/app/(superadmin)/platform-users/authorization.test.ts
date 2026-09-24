import { beforeEach, describe, expect, it, vi } from "vitest";

// The users console writes memberships across tenants — the one thing §3.3
// exists to keep out of a tenant admin's hands. These actions are reachable
// as plain POST endpoints by anyone holding a session, so the guard has to be
// on the action, not on the nav entry that hides the page.

let isSuperadmin = false;

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        // A tenant admin when the flag is off: the most privileged role that
        // still must not reach this.
        user: { id: "user-1", tenantId: "tenant-1", role: "admin", isSuperadmin },
        session: { impersonatedBy: null },
      }),
    },
  },
}));

const memberships = {
  addMembership: vi.fn(async () => ({ id: "m1" })),
  removeMembership: vi.fn(async () => undefined),
};
vi.mock("@/modules/tenancy/memberships", async (importOriginal) => ({
  // MembershipError stays real — the actions branch on the instance.
  ...(await importOriginal<typeof import("@/modules/tenancy/memberships")>()),
  ...memberships,
}));

vi.mock("@/modules/tenancy/users", () => ({
  getUserById: vi.fn(async (id: string) => ({ id, isSuperadmin: false })),
}));
const tenants = {
  createTenant: vi.fn(async (_ctx: unknown, input: { name: string; slug: string }) => ({
    id: "tenant-new",
    ...input,
  })),
  getTenantBySlug: vi.fn(async () => null),
};
vi.mock("@/modules/tenancy/tenants", () => tenants);
vi.mock("@/modules/tenancy/context", async (importOriginal) => ({
  // requireSuperadminContext stays real — it is the guard under test.
  ...(await importOriginal<typeof import("@/modules/tenancy/context")>()),
  buildSystemTenantContext: vi.fn(async () => null),
}));
vi.mock("@/modules/crm/pipelines", () => ({ seedDefaultPipeline: vi.fn(async () => undefined) }));

vi.mock("@/modules/tenancy/audit", () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const empty = { error: null, ok: false };

beforeEach(() => {
  vi.clearAllMocks();
  isSuperadmin = false;
});

describe("the platform users console", () => {
  it("refuses to connect a user when the caller is only a tenant admin", async () => {
    await expect(
      actions.connectUserToTenantAction(
        empty,
        form({ userId: "user-2", tenantId: "tenant-9", role: "admin" }),
      ),
    ).rejects.toThrow();
    expect(memberships.addMembership).not.toHaveBeenCalled();
  });

  it("refuses to disconnect a user when the caller is only a tenant admin", async () => {
    await expect(
      actions.disconnectUserFromTenantAction(empty, form({ userId: "user-2", tenantId: "tenant-9" })),
    ).rejects.toThrow();
    expect(memberships.removeMembership).not.toHaveBeenCalled();
  });

  it("lets a superadmin through", async () => {
    isSuperadmin = true;

    expect(
      await actions.connectUserToTenantAction(
        empty,
        form({ userId: "user-2", tenantId: "tenant-9", role: "agent" }),
      ),
    ).toEqual({ error: null, ok: true });
    expect(memberships.addMembership).toHaveBeenCalledWith({
      userId: "user-2",
      tenantId: "tenant-9",
      role: "agent",
    });

    expect(
      await actions.disconnectUserFromTenantAction(
        empty,
        form({ userId: "user-2", tenantId: "tenant-9" }),
      ),
    ).toEqual({ error: null, ok: true });
    expect(memberships.removeMembership).toHaveBeenCalledWith("tenant-9", "user-2");
  });

  it("reports the last-admin refusal as copy rather than throwing", async () => {
    isSuperadmin = true;
    const { MembershipError } = await import("@/modules/tenancy/memberships");
    memberships.removeMembership.mockRejectedValueOnce(new MembershipError("lastAdmin"));

    expect(
      await actions.disconnectUserFromTenantAction(
        empty,
        form({ userId: "user-2", tenantId: "tenant-9" }),
      ),
    ).toEqual({ error: "lastAdmin", ok: false });
  });

  it("refuses to create a business for a user when the caller is only a tenant admin", async () => {
    await expect(
      actions.createTenantForUserAction(empty, form({ userId: "user-2", name: "Otra empresa" })),
    ).rejects.toThrow();
    expect(tenants.createTenant).not.toHaveBeenCalled();
    expect(memberships.addMembership).not.toHaveBeenCalled();
  });

  it("creates the business and connects the user as its admin for a superadmin", async () => {
    isSuperadmin = true;

    expect(
      await actions.createTenantForUserAction(empty, form({ userId: "user-2", name: "Otra empresa" })),
    ).toEqual({ error: null, ok: true });
    expect(tenants.createTenant).toHaveBeenCalledWith(expect.anything(), {
      name: "Otra empresa",
      slug: "otra-empresa",
    });
    expect(memberships.addMembership).toHaveBeenCalledWith({
      userId: "user-2",
      tenantId: "tenant-new",
      role: "admin",
    });
  });
});
