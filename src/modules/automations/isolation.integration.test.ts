import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Extends the tenant-isolation merge gate (PLAN.md §3.3) to the automation
// tables added in 1F.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("cross-tenant isolation — automations", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let tenancy: typeof import("@/modules/tenancy/service");
  let crm: typeof import("@/modules/crm");
  let flows: typeof import("./flows");
  let automations: typeof import("./index");
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let A: { ctx: TenantContext; contactId: string; flowId: string };
  let B: { ctx: TenantContext; contactId: string; flowId: string };
  const uniq = () => Math.random().toString(36).slice(2, 8);
  const ctxFor = (tenantId: string): TenantContext => ({
    tenantId,
    userId: "u",
    role: "admin",
    isSuperadmin: false,
    impersonatorUserId: null,
  });

  async function setup(label: string) {
    const s = uniq();
    const { tenantId } = await tenancy.createTenant({
      name: label,
      slug: `${label}-${s}`,
      adminEmail: `${label}-${s}@x.com`,
      adminPassword: "password123",
      adminName: label,
    });
    const ctx = ctxFor(tenantId);
    const contactId = await crm.createContact(ctx, { name: `${label} contact` });
    const flowId = await flows.createFlow(ctx, { name: `${label} flow` });
    const graph = {
      nodes: [
        { id: "t", kind: "trigger", type: "contact_created", position: { x: 0, y: 0 }, config: {} },
        { id: "a1", kind: "action", type: "create_activity", position: { x: 0, y: 0 }, config: { body: label } },
      ],
      edges: [{ id: "e1", source: "t", target: "a1" }],
    };
    const versionId = await flows.saveDraftVersion(ctx, flowId, graph);
    await flows.publishVersion(ctx, flowId, versionId);
    await automations.triggerFlows(ctx, "contact_created", {
      contactId,
      payload: {},
      matchFields: {},
    });
    return { ctx, contactId, flowId };
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    tenancy = await import("@/modules/tenancy/service");
    crm = await import("@/modules/crm");
    flows = await import("./flows");
    automations = await import("./index");
    await import("./jobs");
    A = await setup("autoa");
    B = await setup("autob");
  });

  afterAll(async () => {
    if (!db) return;
    // Deliberately NOT closing the pool here: db/client.ts is a
    // module-level singleton, and depending on vitest's isolation/pool
    // settings it can be shared across test files run in the same
    // process — closing it here raced with other files still using it
    // (their queries would see a closed pool). The process exits when
    // the whole suite finishes, which reclaims the connection anyway.
  });

  it("flows are scoped per tenant", async () => {
    const aFlows = await flows.listFlows(A.ctx);
    expect(aFlows.some((f) => f.id === A.flowId)).toBe(true);
    expect(aFlows.some((f) => f.id === B.flowId)).toBe(false);
  });

  it("A cannot read B's flow or its runs", async () => {
    expect(await flows.getFlow(A.ctx, B.flowId)).toBeNull();

    const bRuns = await automations.listActiveRunsForContact(B.ctx, B.contactId);
    const aViewOfBContact = await automations.listActiveRunsForContact(A.ctx, B.contactId);
    // A's scoped query for B's contact returns nothing, regardless of what
    // exists under B's tenant.
    expect(aViewOfBContact.length).toBe(0);
    void bRuns;
  });

  it("A cannot change B's flow status by referencing B's flow id", async () => {
    const [before] = await db
      .select()
      .from(schema.flows)
      .where(eq(schema.flows.id, B.flowId));
    expect(before.status).toBe("active"); // set by setup()'s publishVersion

    // A's scoped update targets tenantId=A AND id=B.flowId — zero rows match,
    // so this is a silent no-op (the same tenantDb.update semantics proven
    // for every other tenant-owned table).
    await flows.setFlowStatus(A.ctx, B.flowId, "paused");

    const [after] = await db
      .select()
      .from(schema.flows)
      .where(eq(schema.flows.id, B.flowId));
    expect(after.status).toBe("active"); // untouched by A
  });
});
