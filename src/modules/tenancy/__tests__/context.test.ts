import { describe, expect, it } from "vitest";
import {
  deriveSuperadminContext,
  deriveTenantContext,
  NotASuperadminError,
  NotATenantUserError,
  UnauthenticatedError,
} from "../context";

describe("deriveTenantContext", () => {
  it("throws UnauthenticatedError for a null session", () => {
    expect(() => deriveTenantContext(null)).toThrow(UnauthenticatedError);
  });

  it("throws NotATenantUserError when tenantId is missing", () => {
    expect(() =>
      deriveTenantContext({
        user: { id: "u1", tenantId: null, role: "admin" },
        session: {},
      }),
    ).toThrow(NotATenantUserError);
  });

  it("throws NotATenantUserError for a superadmin session", () => {
    expect(() =>
      deriveTenantContext({
        user: { id: "u1", tenantId: null, role: "superadmin" },
        session: {},
      }),
    ).toThrow(NotATenantUserError);
  });

  it("throws NotATenantUserError for an unrecognized role", () => {
    expect(() =>
      deriveTenantContext({
        user: { id: "u1", tenantId: "t1", role: "something-else" },
        session: {},
      }),
    ).toThrow(NotATenantUserError);
  });

  it("returns a tenant context for a plain admin session", () => {
    const ctx = deriveTenantContext({
      user: { id: "u1", tenantId: "t1", role: "admin" },
      session: {},
    });

    expect(ctx).toEqual({
      userId: "u1",
      tenantId: "t1",
      role: "admin",
      isImpersonating: false,
      actorUserId: "u1",
    });
  });

  it("marks impersonation and preserves the real actor's id", () => {
    const ctx = deriveTenantContext({
      user: { id: "u1", tenantId: "t1", role: "agent" },
      session: { impersonatedBy: "superadmin-1" },
    });

    expect(ctx.isImpersonating).toBe(true);
    expect(ctx.actorUserId).toBe("superadmin-1");
    expect(ctx.userId).toBe("u1");
  });
});

describe("deriveSuperadminContext", () => {
  it("throws UnauthenticatedError for a null session", () => {
    expect(() => deriveSuperadminContext(null)).toThrow(UnauthenticatedError);
  });

  it("throws NotASuperadminError for a tenant admin session", () => {
    expect(() =>
      deriveSuperadminContext({
        user: { id: "u1", tenantId: "t1", role: "admin" },
        session: {},
      }),
    ).toThrow(NotASuperadminError);
  });

  it("throws NotASuperadminError when the superadmin is themself impersonated", () => {
    expect(() =>
      deriveSuperadminContext({
        user: { id: "u1", tenantId: null, role: "superadmin" },
        session: { impersonatedBy: "someone" },
      }),
    ).toThrow(NotASuperadminError);
  });

  it("returns a superadmin context for a real superadmin session", () => {
    const ctx = deriveSuperadminContext({
      user: { id: "u1", tenantId: null, role: "superadmin" },
      session: {},
    });

    expect(ctx).toEqual({ userId: "u1" });
  });
});
