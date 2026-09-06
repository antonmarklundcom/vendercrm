import { afterAll, beforeAll, describe, expect, it } from "vitest";

// `maxEmailsPerDay` (PLAN.md §15.1, §15.8 P4) — the same plan-limit
// enforcement shape as maxUsers/maxContacts (modules/tenancy/limits.ts),
// against real `email_log` rows and a real plan/subscription.

const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("maxEmailsPerDay (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let logEmail: (typeof import("./email-log"))["logEmail"];
  let checkPlanLimit: (typeof import("./limits"))["checkPlanLimit"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let ctx: TenantContext;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    ({ logEmail } = await import("./email-log"));
    ({ checkPlanLimit } = await import("./limits"));
    const { createTenant } = await import("./tenants");
    const { createPlan } = await import("./plans");
    const { createSubscription } = await import("./subscriptions");

    const superadmin = { userId: "sa-p4-cap", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: "Cap test",
      slug: `p4-cap-${newId()}`,
    });
    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };

    const plan = await createPlan(superadmin, {
      name: `Plan cap ${newId()}`,
      durationMonths: 3,
      price: 100000,
      limits: { maxEmailsPerDay: 2 },
    });
    await createSubscription(superadmin, { tenantId: ctx.tenantId, planId: plan!.id });
  });

  it("is unlimited before any email has been sent", async () => {
    const check = await checkPlanLimit(ctx.tenantId, "maxEmailsPerDay");
    expect(check.allowed).toBe(true);
    expect(check.limit).toBe(2);
  });

  it("refuses once the daily cap is reached, and skipped/failed sends don't count", async () => {
    await logEmail(ctx, { to: "a@example.com", subject: "s", kind: "automated", status: "sent" });
    await logEmail(ctx, { to: "b@example.com", subject: "s", kind: "automated", status: "sent" });
    // Neither of these should push a tenant at the cap over it.
    await logEmail(ctx, { to: "c@example.com", subject: "s", kind: "automated", status: "skipped" });
    await logEmail(ctx, { to: "d@example.com", subject: "s", kind: "automated", status: "failed" });

    const check = await checkPlanLimit(ctx.tenantId, "maxEmailsPerDay");
    expect(check.allowed).toBe(false);
    expect(check.current).toBe(2);
  });

  it("sendEmail refuses an automated send once the cap is hit, and logs it as skipped rather than failed", async () => {
    const { sendEmail } = await import("@/lib/email/index");

    const before = await checkPlanLimit(ctx.tenantId, "maxEmailsPerDay");
    expect(before.allowed).toBe(false); // still over cap from the previous test

    const sent = await sendEmail({
      to: "e@example.com",
      subject: "automated over cap",
      html: "<p>hi</p>",
      ctx,
      kind: "automated",
    });
    expect(sent).toBe(false);

    // The cap refusal is logged before RESEND_API_KEY is ever checked, so
    // `current` must not have grown by this attempt — a skipped send is not
    // itself a sent one.
    const after = await checkPlanLimit(ctx.tenantId, "maxEmailsPerDay");
    expect(after.current).toBe(before.current);
  });
});
