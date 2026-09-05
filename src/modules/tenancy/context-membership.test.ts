import { beforeEach, describe, expect, it, vi } from "vitest";

// Now that one person can hold memberships in several businesses (PLAN.md
// §3.1, reopened), the session cookie carries *which* business they were last
// in — and nothing else that authorization may believe. The role has to come
// from the membership, re-read per request.
//
// This suite pins that down for the one case a refactor would quietly break:
// a session claiming `role: "admin"` while the membership for the active
// business says `agent`. If `getTenantContext` ever reads the session's copy
// again, `requireTenantAdmin` starts letting an agent through in a business
// where they were demoted — with a cookie they already hold.
//
// Nothing here touches MySQL, so it runs on every `npm test` rather than only
// in CI: it is a merge gate for a one-line mistake.

/** What the session cookie claims. Deliberately allowed to lie. */
let sessionRole: string | null = "admin";
/** What `tenant_memberships` says for the active business — the truth. */
let membershipRole: "admin" | "agent" | null = "agent";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "user-1", tenantId: "tenant-1", role: sessionRole },
        session: { impersonatedBy: null },
      }),
    },
  },
}));

// `getActiveTenantUser` is the one boundary stubbed: in the real module it
// joins the user row to the live membership and returns the membership's role
// (see users.ts). Modelling it that way here keeps the test about what
// `getTenantContext` does with the answer. `context.ts` imports nothing else
// from `./users`, so the mock stops there rather than spreading
// `importOriginal()` — that would pull in the real module, which imports the
// db client and throws on missing env vars, defeating the point of a suite
// that touches no MySQL and no config.
vi.mock("./users", () => ({
  getActiveTenantUser: async (userId: string, tenantId: string) =>
    membershipRole === null
      ? null
      : { id: userId, tenantId, role: membershipRole, banned: false },
}));

vi.mock("./tenants", () => ({
  getTenant: async (id: string) => ({
    id,
    name: "Tenant",
    slug: "tenant",
    status: "active",
  }),
}));

vi.mock("./subscriptions", () => ({
  computeAccessStatus: async () => "active" as const,
}));

describe("tenant context takes the role from the membership, not the session", () => {
  beforeEach(() => {
    sessionRole = "admin";
    membershipRole = "agent";
  });

  it("resolves the membership's role even when the session claims a higher one", async () => {
    const { getTenantContext } = await import("./context");

    const ctx = await getTenantContext();

    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("agent");
  });

  it("refuses admin-only work to a session that claims admin but is an agent here", async () => {
    const { requireTenantAdmin } = await import("./context");

    await expect(requireTenantAdmin()).rejects.toThrow();
  });

  it("grants admin when the membership itself says admin", async () => {
    membershipRole = "admin";
    const { requireTenantAdmin } = await import("./context");

    const ctx = await requireTenantAdmin();

    expect(ctx.role).toBe("admin");
  });

  it("has no context at all when the membership is gone, whatever the cookie says", async () => {
    // Access revoked, or deactivated for this business, or a forged tenant id
    // in the session — all of them land here, and all of them mean "no".
    membershipRole = null;
    const { getTenantContext, requireTenantContext } = await import("./context");

    expect(await getTenantContext()).toBeNull();
    await expect(requireTenantContext()).rejects.toThrow();
  });

  it("has no context when the session carries no active business", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/server", () => ({
      auth: {
        api: {
          getSession: async () => ({
            user: { id: "user-1", tenantId: null, role: "admin" },
            session: { impersonatedBy: null },
          }),
        },
      },
    }));

    const { getTenantContext } = await import("./context");
    expect(await getTenantContext()).toBeNull();

    vi.doUnmock("@/lib/auth/server");
    vi.resetModules();
  });
});
