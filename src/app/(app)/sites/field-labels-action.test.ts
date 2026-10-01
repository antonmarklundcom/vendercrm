import { beforeEach, describe, expect, it, vi } from "vitest";

// Authorization of the field-label save (PLAN.md §19.2, L3). Same approach as
// src/modules/tenancy/authorization.test.ts: the session boundary is stubbed,
// the real requireTenantAdmin runs, and the service must never be reached by
// an agent or an anonymous caller.

let session: { user: { id: string; tenantId: string; role: string } } | null = null;

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => (session ? { ...session, session: { impersonatedBy: null } } : null),
    },
  },
}));
vi.mock("@/modules/tenancy/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/tenancy/users")>()),
  getActiveTenantUser: async (userId: string, tenantId: string) => ({
    id: userId,
    tenantId,
    role: session?.user.role,
    banned: false,
  }),
}));
vi.mock("@/modules/tenancy/tenants", () => ({
  getTenant: async (id: string) => ({ id, name: "T", slug: "t", status: "active" }),
}));
vi.mock("@/modules/tenancy/subscriptions", () => ({
  computeAccessStatus: async () => "active" as const,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirected");
  }),
}));

const save = vi.fn(async () => ({ ok: true as const, changed: ["ciudad"] }));
vi.mock("@/modules/sites/field-labels", () => ({ saveSiteFieldSettings: save }));

const { saveSiteFieldLabelsAction } = await import("./actions");

const initial = { error: null, saved: false } as const;

function form(rows: Array<{ key: string; label: string; prominent?: boolean }>): FormData {
  const data = new FormData();
  data.set("siteId", "site-1");
  for (const row of rows) {
    data.append("key", row.key);
    data.append("label", row.label);
    if (row.prominent) data.append("prominent", row.key);
  }
  return data;
}

beforeEach(() => {
  save.mockClear();
  session = { user: { id: "u1", tenantId: "t1", role: "admin" } };
});

describe("saveSiteFieldLabelsAction authorization", () => {
  it("refuses an agent and never reaches the service", async () => {
    session = { user: { id: "u1", tenantId: "t1", role: "agent" } };
    await expect(
      saveSiteFieldLabelsAction(initial, form([{ key: "ciudad", label: "Ciudad" }])),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    session = null;
    await expect(
      saveSiteFieldLabelsAction(initial, form([{ key: "ciudad", label: "Ciudad" }])),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it("passes the parsed rows to the service for an admin", async () => {
    const state = await saveSiteFieldLabelsAction(
      initial,
      form([
        { key: "ciudad", label: " Ciudad del inmueble ", prominent: true },
        { key: "finalidad", label: "" },
      ]),
    );
    expect(state).toEqual({ error: null, saved: true });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "site-1", [
      { key: "ciudad", label: " Ciudad del inmueble ", prominent: true },
      { key: "finalidad", label: "", prominent: false },
    ]);
  });

  it("rejects mismatched key/label lists without saving", async () => {
    const data = form([{ key: "ciudad", label: "x" }]);
    data.append("key", "extra");
    expect(await saveSiteFieldLabelsAction(initial, data)).toEqual({ error: "unknown", saved: false });
    expect(save).not.toHaveBeenCalled();
  });
});
