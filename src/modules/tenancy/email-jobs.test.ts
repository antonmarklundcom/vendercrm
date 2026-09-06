import { beforeEach, describe, expect, it, vi } from "vitest";

// `email.verify_domain`'s state machine (PLAN.md §15.1, §15.8 P4): pending
// within the window reschedules, verified/failed stop the chain, and past
// the 72h deadline the domain is marked failed. Rows and Resend mocked, the
// same shape notifications/jobs.test.ts tests sendPush.

vi.mock("@/worker/handlers", () => ({ registerHandler: () => {} }));

const enqueue = vi.fn();
vi.mock("@/lib/queue", () => ({ enqueue: (...args: unknown[]) => enqueue(...args) }));

const ctx = {
  tenantId: "tenant-1",
  userId: "system",
  role: "admin" as const,
  impersonatorUserId: null,
  accessStatus: "active" as const,
};

const buildSystemTenantContext = vi.fn();
vi.mock("./context", () => ({
  buildSystemTenantContext: (...args: unknown[]) => buildSystemTenantContext(...args),
}));

const getTenantEmailDomain = vi.fn();
const refreshTenantEmailDomain = vi.fn();
const markTenantEmailDomainFailed = vi.fn();
vi.mock("./email-domains", () => ({
  getTenantEmailDomain: (...args: unknown[]) => getTenantEmailDomain(...args),
  refreshTenantEmailDomain: (...args: unknown[]) => refreshTenantEmailDomain(...args),
  markTenantEmailDomainFailed: (...args: unknown[]) => markTenantEmailDomainFailed(...args),
}));

beforeEach(() => {
  enqueue.mockReset().mockResolvedValue("job-1");
  buildSystemTenantContext.mockReset().mockResolvedValue(ctx);
  getTenantEmailDomain.mockReset();
  refreshTenantEmailDomain.mockReset();
  markTenantEmailDomainFailed.mockReset().mockResolvedValue(undefined);
});

const basePayload = {
  tenantId: "tenant-1",
  domainId: "domain-1",
  deadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

describe("processDomainVerification", () => {
  it("reschedules another poll when still pending inside the window", async () => {
    getTenantEmailDomain.mockResolvedValue({ id: "domain-1", status: "pending" });
    refreshTenantEmailDomain.mockResolvedValue({ id: "domain-1", status: "pending" });

    const { processDomainVerification } = await import("./email-jobs");
    await processDomainVerification(basePayload);

    expect(enqueue).toHaveBeenCalledWith(
      "email.verify_domain",
      basePayload,
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
    expect(markTenantEmailDomainFailed).not.toHaveBeenCalled();
  });

  it("marks the domain failed once the deadline has passed", async () => {
    getTenantEmailDomain.mockResolvedValue({ id: "domain-1", status: "pending" });
    refreshTenantEmailDomain.mockResolvedValue({ id: "domain-1", status: "pending" });

    const { processDomainVerification } = await import("./email-jobs");
    await processDomainVerification({
      ...basePayload,
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(markTenantEmailDomainFailed).toHaveBeenCalledWith(ctx, "domain-1");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("stops the chain once Resend reports verified", async () => {
    getTenantEmailDomain.mockResolvedValue({ id: "domain-1", status: "pending" });
    refreshTenantEmailDomain.mockResolvedValue({ id: "domain-1", status: "verified" });

    const { processDomainVerification } = await import("./email-jobs");
    await processDomainVerification(basePayload);

    expect(enqueue).not.toHaveBeenCalled();
    expect(markTenantEmailDomainFailed).not.toHaveBeenCalled();
  });

  it("does nothing when a manual retry already settled the domain between polls", async () => {
    getTenantEmailDomain.mockResolvedValue({ id: "domain-1", status: "verified" });

    const { processDomainVerification } = await import("./email-jobs");
    await processDomainVerification(basePayload);

    expect(refreshTenantEmailDomain).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does nothing when the domain row is gone", async () => {
    getTenantEmailDomain.mockResolvedValue(null);

    const { processDomainVerification } = await import("./email-jobs");
    await processDomainVerification(basePayload);

    expect(refreshTenantEmailDomain).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
