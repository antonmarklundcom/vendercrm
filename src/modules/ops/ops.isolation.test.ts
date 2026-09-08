import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The security boundary of PLAN.md §18 (§18.1.2), and the one thing
// `prompts/_handoff-o.md` forbids widening to make a test pass: an ops token
// is create-only and blind to everything that existed before it.
//
// Every refusal here must be a 404 rather than a 403 — a 403 would confirm
// that the id names a real object, which is exactly what a blind token must
// not be able to learn.
//
// Runs only against a real MySQL (CI provides one as a service container),
// skipped locally without DATABASE_URL — same as modules/crm/isolation.test.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("claude ops isolation", () => {
  let db: (typeof import("@/db/client"))["db"];
  let newId: (typeof import("@/lib/ids"))["newId"];

  type OpsTokenRow = import("./tokens").OpsTokenRow;
  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  const superadmin = { userId: "sa-ops-test", impersonatorUserId: null } as const;

  let ops: typeof import("./index");
  let sites: typeof import("@/modules/sites/sites");
  let keys: typeof import("@/modules/sites/keys");
  let pipelines: typeof import("@/modules/crm/pipelines");

  let tokenA: OpsTokenRow;
  let tokenAPlaintext: string;
  let tokenB: OpsTokenRow;

  /** A business that existed before any ops token did, with a site, a
   * pipeline and a key of its own — the thing the guard must hide. */
  let strangerTenantId: string;
  let strangerCtx: TenantContext;
  let strangerSiteId: string;
  let strangerPipelineId: string;
  let strangerKeyId: string;

  let batchA: import("./batches").OpsBatchRow;

  async function resolve(plaintext: string): Promise<OpsTokenRow> {
    const row = await ops.resolveOpsToken(plaintext);
    expect(row).not.toBeNull();
    return row!;
  }

  async function addRow(
    token: OpsTokenRow,
    batchId: string,
    input: import("./batches").CreateOpsRowInput,
  ) {
    const [row] = await ops.addOpsRows(token, batchId, [input]);
    return row;
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    ({ newId } = await import("@/lib/ids"));
    ops = await import("./index");
    sites = await import("@/modules/sites/sites");
    keys = await import("@/modules/sites/keys");
    pipelines = await import("@/modules/crm/pipelines");

    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");

    const created = await ops.createOpsToken(superadmin, { label: "PC del dueño" });
    tokenAPlaintext = created.plaintext;
    tokenA = await resolve(created.plaintext);
    const createdB = await ops.createOpsToken(superadmin, { label: "otra PC" });
    tokenB = await resolve(createdB.plaintext);

    const stranger = await createTenant(superadmin, {
      name: "Negocio ajeno",
      slug: `ops-stranger-${newId().slice(-8)}`.toLowerCase(),
    });
    strangerTenantId = stranger!.id;
    strangerCtx = (await buildSystemTenantContext(strangerTenantId))!;

    const site = await sites.createSite(strangerCtx, {
      name: "Sitio ajeno",
      slug: `ajeno-${newId().slice(-6)}`.toLowerCase(),
    });
    strangerSiteId = site.id;
    strangerKeyId = (await keys.listActiveApiKeys(strangerCtx, site.id))[0]!.id;
    strangerPipelineId = (await pipelines.seedDefaultPipeline(strangerCtx))!.id;

    batchA = await ops.createOpsBatch(tokenA, { title: "dentista de Luque" });
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  it("cannot touch a tenant, site, pipeline or key that predates it", async () => {
    expect(await ops.mayTouch(tokenA, "tenant", strangerTenantId)).toBe(false);
    expect(await ops.mayTouch(tokenA, "site", strangerSiteId)).toBe(false);
    expect(await ops.mayTouch(tokenA, "pipeline", strangerPipelineId)).toBe(false);
    expect(await ops.mayTouch(tokenA, "api_key", strangerKeyId)).toBe(false);

    // 404, not 403: the refusal must not confirm that the id exists.
    for (const entity of ["tenant", "site", "pipeline", "api_key"] as const) {
      const id = {
        tenant: strangerTenantId,
        site: strangerSiteId,
        pipeline: strangerPipelineId,
        api_key: strangerKeyId,
      }[entity];
      await expect(ops.assertMayTouch(tokenA, entity, id)).rejects.toMatchObject({
        status: 404,
      });
    }
  });

  it("cannot provision into a pre-existing tenant that is not allowlisted", async () => {
    const row = await addRow(tokenA, batchA.id, {
      domain: `ajeno-${newId().slice(-6)}.com.py`.toLowerCase(),
      display_name: "Intento en negocio ajeno",
      tenant_mode: "existing",
      tenant_id: strangerTenantId,
    });

    await expect(ops.provisionTenant(tokenA, row.id)).rejects.toMatchObject({ status: 404 });
    await expect(ops.provisionSite(tokenA, row.id)).rejects.toMatchObject({ status: 404 });
  });

  it("cannot read or write another token's batch or rows", async () => {
    const row = await addRow(tokenA, batchA.id, {
      domain: `mia-${newId().slice(-6)}.com.py`.toLowerCase(),
      display_name: "Fila de A",
    });

    await expect(ops.requireOwnBatch(tokenB, batchA.id)).rejects.toMatchObject({ status: 404 });
    await expect(ops.listOpsRows(tokenB, batchA.id)).rejects.toMatchObject({ status: 404 });
    await expect(ops.requireOwnRow(tokenB, row.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      ops.addOpsRows(tokenB, batchA.id, [{ domain: "x.com", display_name: "x" }]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      ops.updateOpsRow(tokenB, row.id, { needs_input: "mine now" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(ops.provisionSite(tokenB, row.id)).rejects.toMatchObject({ status: 404 });

    // And B's own listing does not contain A's batch at all.
    const batchesForB = await ops.listOpsBatches(tokenB);
    expect(batchesForB.some((batch) => batch.id === batchA.id)).toBe(false);
  });

  it("provisions its own objects, and the site is born inactive", async () => {
    const suffix = newId().slice(-8).toLowerCase();
    const row = await addRow(tokenA, batchA.id, {
      domain: `dentista${suffix}.com.py`,
      display_name: "Dentista de Luque",
      details: {
        admin_email: `dueno-${suffix}@example.com`,
        owner_email: `dueno-${suffix}@example.com`,
        stages: ["Nuevo", "Contactado", "Ganado"],
        tags: ["ortodoncia"],
      },
    });

    const tenant = await ops.provisionTenant(tokenA, row.id);
    expect(await ops.mayTouch(tokenA, "tenant", tenant.tenantId)).toBe(true);

    const site = await ops.provisionSite(tokenA, row.id);
    expect(site.isActive).toBe(false);
    expect(await ops.mayTouch(tokenA, "site", site.siteId)).toBe(true);
    // The other token created none of this, and sees none of it.
    expect(await ops.mayTouch(tokenB, "site", site.siteId)).toBe(false);

    const pipeline = await ops.provisionPipeline(tokenA, row.id);
    expect(pipeline.stageIds).toHaveLength(3);
    expect(pipeline.tagIds).toHaveLength(1);
    expect(pipeline.ownerUserId).not.toBeNull();

    const key = await ops.provisionKey(tokenA, row.id);
    expect(key.plaintext).toMatch(/^vc_live_/);

    const lead = await ops.provisionTestLead(tokenA, row.id);
    expect(lead.contactId).toBeTruthy();

    // Still inactive, and waiting for a human — a session cannot take a site
    // live (§18.1.4).
    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");
    const ctx = (await buildSystemTenantContext(tenant.tenantId))!;
    const stored = await sites.getSite(ctx, site.siteId);
    expect(stored!.isActive).toBe(false);

    const after = await ops.requireOwnRow(tokenA, row.id);
    expect(after.state).toBe("awaiting_approval");

    // And there is no state a session can write that means "approved".
    const patched = await ops.updateOpsRow(tokenA, row.id, { needs_input: "esperando" });
    expect(patched.state).toBe("awaiting_approval");
  });

  it("an allowlisted tenant unlocks site creation there, and nothing else", async () => {
    await ops.setOpsTokenAllowlist(tokenA.id, [strangerTenantId]);
    // Re-resolve the token, which is exactly what the next request does — the
    // allowlist is read from the row on every call, never cached.
    const allowlisted = await resolve(tokenAPlaintext);

    const row = await addRow(allowlisted, batchA.id, {
      domain: `sucursal-${newId().slice(-6)}.com.py`.toLowerCase(),
      display_name: "Sucursal en negocio existente",
      tenant_mode: "existing",
      tenant_id: strangerTenantId,
    });

    const tenantStep = await ops.provisionTenant(allowlisted, row.id);
    expect(tenantStep.tenantId).toBe(strangerTenantId);

    const site = await ops.provisionSite(allowlisted, row.id);
    expect(site.isActive).toBe(false);

    // The allowlist bought exactly one thing. The tenant's own site, pipeline
    // and key are still invisible.
    expect(await ops.mayTouch(allowlisted, "site", strangerSiteId)).toBe(false);
    expect(await ops.mayTouch(allowlisted, "pipeline", strangerPipelineId)).toBe(false);
    expect(await ops.mayTouch(allowlisted, "api_key", strangerKeyId)).toBe(false);
    await expect(
      ops.assertMayTouch(allowlisted, "site", strangerSiteId),
    ).rejects.toMatchObject({ status: 404 });

    await ops.setOpsTokenAllowlist(tokenA.id, []);
  });

  it("cannot re-point a provisioned row at another business", async () => {
    const suffix = newId().slice(-8).toLowerCase();
    const row = await addRow(tokenA, batchA.id, {
      domain: `taller${suffix}.com.py`,
      display_name: `Taller ${suffix}`,
      details: { admin_email: `taller-${suffix}@example.com` },
    });

    await ops.provisionTenant(tokenA, row.id);
    await ops.provisionSite(tokenA, row.id);

    // The row's business is settled once the tenant step has run: a PATCH
    // that moved it would put the pipeline, key and test lead in a different
    // business than the site.
    await expect(
      ops.updateOpsRow(tokenA, row.id, { tenant_id: strangerTenantId }),
    ).rejects.toMatchObject({ status: 422 });

    // And even if the column were changed some other way, the steps read the
    // site back through the row's tenant, which then finds nothing.
    const { opsBatchRows } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(opsBatchRows)
      .set({ tenantId: strangerTenantId })
      .where(eq(opsBatchRows.id, row.id));

    await expect(ops.provisionPipeline(tokenA, row.id)).rejects.toMatchObject({ status: 404 });
    await expect(ops.provisionKey(tokenA, row.id)).rejects.toMatchObject({ status: 404 });
    await expect(ops.provisionTestLead(tokenA, row.id)).rejects.toMatchObject({ status: 404 });

    // Nothing was created in the stranger's business.
    const { listPipelines } = await import("@/modules/crm/pipelines");
    const strangerPipelines = await listPipelines(strangerCtx);
    expect(strangerPipelines).toHaveLength(1);
    expect(strangerPipelines[0]!.id).toBe(strangerPipelineId);
  });

  it("a revoked or expired token resolves to nothing", async () => {
    const revoked = await ops.createOpsToken(superadmin, { label: "para revocar" });
    expect(await ops.resolveOpsToken(revoked.plaintext)).not.toBeNull();
    await ops.revokeOpsToken(revoked.id);
    expect(await ops.resolveOpsToken(revoked.plaintext)).toBeNull();

    const expired = await ops.createOpsToken(superadmin, {
      label: "vencido",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await ops.resolveOpsToken(expired.plaintext)).toBeNull();

    expect(await ops.resolveOpsToken("vc_ops_not-a-real-token")).toBeNull();
    expect(await ops.resolveOpsToken("")).toBeNull();
  });
});
