import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The behaviours §18 promises a session, beyond the guard itself: every step
// is idempotent per (row, step), a failure is stored on the row verbatim, the
// `allowInactive` flag is the ops path's alone, and every call leaves an
// audit entry the Claude Ops log can find.
//
// DB-backed, like the isolation suite next to it.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("claude ops provisioning", () => {
  let db: (typeof import("@/db/client"))["db"];
  let newId: (typeof import("@/lib/ids"))["newId"];
  let ops: typeof import("./index");

  type OpsTokenRow = import("./tokens").OpsTokenRow;
  const superadmin = { userId: "sa-ops-int", impersonatorUserId: null } as const;

  let token: OpsTokenRow;
  let batchId: string;

  async function freshRow(overrides: Partial<import("./batches").OpsRowDetails> = {}) {
    const suffix = newId().slice(-8).toLowerCase();
    const [row] = await ops.addOpsRows(token, batchId, [
      {
        domain: `taller${suffix}.com.py`,
        display_name: `Taller ${suffix}`,
        details: {
          admin_email: `admin-${suffix}@example.com`,
          owner_email: `admin-${suffix}@example.com`,
          ...overrides,
        },
      },
    ]);
    return row;
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    ({ newId } = await import("@/lib/ids"));
    ops = await import("./index");

    const created = await ops.createOpsToken(superadmin, { label: "integración" });
    token = (await ops.resolveOpsToken(created.plaintext))!;
    batchId = (await ops.createOpsBatch(token, { title: "lote de prueba" })).id;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  it("repeats every step without creating anything twice", async () => {
    const row = await freshRow();

    const tenant1 = await ops.provisionTenant(token, row.id);
    const tenant2 = await ops.provisionTenant(token, row.id);
    expect(tenant2.repeated).toBe(true);
    expect(tenant2.tenantId).toBe(tenant1.tenantId);

    const site1 = await ops.provisionSite(token, row.id);
    const site2 = await ops.provisionSite(token, row.id);
    expect(site2.repeated).toBe(true);
    expect(site2.siteId).toBe(site1.siteId);

    const pipeline1 = await ops.provisionPipeline(token, row.id);
    const pipeline2 = await ops.provisionPipeline(token, row.id);
    expect(pipeline2.repeated).toBe(true);
    expect(pipeline2.pipelineId).toBe(pipeline1.pipelineId);

    const key1 = await ops.provisionKey(token, row.id);
    const key2 = await ops.provisionKey(token, row.id);
    expect(key2.repeated).toBe(true);
    expect(key2.keyId).toBe(key1.keyId);
    // There is no plaintext to hand back a second time, and saying so beats
    // quietly issuing a second key the website will never hold.
    expect(key2.plaintext).toBeNull();

    const lead1 = await ops.provisionTestLead(token, row.id);
    const lead2 = await ops.provisionTestLead(token, row.id);
    expect(lead2.repeated).toBe(true);
    expect(lead2.contactId).toBe(lead1.contactId);

    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");
    const ctx = (await buildSystemTenantContext(tenant1.tenantId))!;

    const { listSites } = await import("@/modules/sites/sites");
    expect(await listSites(ctx)).toHaveLength(1);

    const { listPipelines } = await import("@/modules/crm/pipelines");
    expect(await listPipelines(ctx)).toHaveLength(1);

    const { listActiveApiKeys } = await import("@/modules/sites/keys");
    const active = await listActiveApiKeys(ctx, site1.siteId);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(key1.keyId);

    const { listContacts } = await import("@/modules/crm/contacts");
    expect(await listContacts(ctx)).toHaveLength(1);
  });

  it("keeps the public ingest lane closed to an inactive site", async () => {
    const row = await freshRow();
    await ops.provisionTenant(token, row.id);
    await ops.provisionSite(token, row.id);
    await ops.provisionPipeline(token, row.id);
    const key = await ops.provisionKey(token, row.id);

    // The same key, on the public route's own entry point: refused, because
    // the site has not been approved. This is the regression that makes
    // `allowInactive` safe to exist at all.
    const { ingestLead } = await import("@/modules/sites/ingest");
    const refused = await ingestLead(key.plaintext!, {
      phone: "+595981777111",
      idempotency_key: `public-${row.id}`,
    });
    expect(refused).toMatchObject({ ok: false, status: 403, error: "Site is inactive" });

    // The ops test-lead step reaches the same site, because it is the one
    // caller that passes the flag.
    const lead = await ops.provisionTestLead(token, row.id);
    expect(lead.contactId).toBeTruthy();
  });

  it("stores a failure on the row verbatim, and answers 422 rather than guessing", async () => {
    const row = await freshRow();
    await ops.provisionTenant(token, row.id);
    await ops.provisionSite(token, row.id);

    // An owner e-mail that names nobody in this business.
    await ops.updateOpsRow(token, row.id, { details: { owner_email: "nadie@example.com" } });
    await expect(ops.provisionPipeline(token, row.id)).rejects.toMatchObject({ status: 422 });

    const failed = await ops.requireOwnRow(token, row.id);
    expect(failed.state).toBe("failed");
    const lastError = failed.lastError as import("./batches").OpsLastError;
    expect(lastError.step).toBe("pipeline");
    expect(lastError.status).toBe(422);
    expect(lastError.reason).toContain("nadie@example.com");

    // And the step is re-runnable once the row is corrected — a failure is a
    // question, not a dead end.
    const details = ops.rowDetails(failed);
    await ops.updateOpsRow(token, row.id, { details: { owner_email: details.admin_email } });
    const pipeline = await ops.provisionPipeline(token, row.id);
    expect(pipeline.pipelineId).toBeTruthy();

    const recovered = await ops.requireOwnRow(token, row.id);
    expect(recovered.state).toBe("running");
    expect(recovered.lastError).toBeNull();
  });

  it("refuses a second tenant for an e-mail that already has a user", async () => {
    const first = await freshRow();
    await ops.provisionTenant(token, first.id);
    const taken = ops.rowDetails(await ops.requireOwnRow(token, first.id)).admin_email!;

    const second = await freshRow({ admin_email: taken, owner_email: taken });
    await expect(ops.provisionTenant(token, second.id)).rejects.toMatchObject({ status: 422 });
  });

  it("audits every call with via and batch_id", async () => {
    const row = await freshRow();
    const tenant = await ops.provisionTenant(token, row.id);
    await ops.provisionSite(token, row.id);

    const { listAuditLog } = await import("@/modules/tenancy/audit");
    const entries = await listAuditLog(200);
    const mine = entries.filter(
      (entry) => (entry.payload as { row_id?: string })?.row_id === row.id,
    );

    expect(mine.length).toBeGreaterThanOrEqual(2);
    for (const entry of mine) {
      const payload = entry.payload as { via?: string; batch_id?: string };
      expect(payload.via).toBe(ops.opsVia(token));
      expect(payload.via).toMatch(/^ops_token:vc_ops_/);
      expect(payload.batch_id).toBe(batchId);
      // The actor is the token's owner: a token is a credential, not an
      // identity of its own.
      expect(entry.actorUserId).toBe(superadmin.userId);
    }

    expect(mine.some((entry) => entry.action === "ops.tenant_created")).toBe(true);
    expect(mine.some((entry) => entry.action === "ops.site_created")).toBe(true);
    expect(mine.some((entry) => entry.tenantId === tenant.tenantId)).toBe(true);
  });

  it("derives a site slug from the domain", async () => {
    expect(ops.slugFromDomain("https://www.DentistaLuque.com.py/contacto")).toBe("dentistaluque");
    expect(ops.slugFromDomain("taller-lopez.com")).toBe("taller-lopez");
    expect(ops.slugFromDomain("...")).toBe("site");
  });
});
