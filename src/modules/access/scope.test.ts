import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Per-user site access (PLAN.md §5.2). This is the suite that matters most
// in the whole codebase after tenant isolation: a dentist client seeing
// another client's leads is a breach, not a bug. Real MySQL only.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("per-user site scope", () => {
  let db: (typeof import("@/db/client"))["db"];
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let seedDefaultPipeline: (typeof import("@/modules/crm/pipelines"))["seedDefaultPipeline"];
  let listStagesForPipeline: (typeof import("@/modules/crm/pipelines"))["listStagesForPipeline"];
  let createSite: (typeof import("@/modules/sites/sites"))["createSite"];
  let listSites: (typeof import("@/modules/sites/sites"))["listSites"];
  let getSite: (typeof import("@/modules/sites/sites"))["getSite"];
  let ingestLead: (typeof import("@/modules/sites/ingest"))["ingestLead"];
  let listContacts: (typeof import("@/modules/crm/contacts"))["listContacts"];
  let getContact: (typeof import("@/modules/crm/contacts"))["getContact"];
  let listDealsForPipeline: (typeof import("@/modules/crm/deals"))["listDealsForPipeline"];
  let getDeal: (typeof import("@/modules/crm/deals"))["getDeal"];
  let getLeadStats: (typeof import("@/modules/leads/stats"))["getLeadStats"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let owner: TenantContext;
  let dentistSiteId: string;
  let materialsSiteId: string;
  let pipelineId: string;
  let dentistContactId: string;
  let materialsContactId: string;
  let dentistDealId: string;
  let materialsDealId: string;

  /** A user restricted to exactly the given sites. */
  function scopedTo(siteIds: string[], role: TenantContext["role"] = "client"): TenantContext {
    return { ...owner, userId: `scoped-${siteIds.join("-")}`, role, siteScope: siteIds };
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ seedDefaultPipeline, listStagesForPipeline } = await import("@/modules/crm/pipelines"));
    ({ createSite, listSites, getSite } = await import("@/modules/sites/sites"));
    ({ ingestLead } = await import("@/modules/sites/ingest"));
    ({ listContacts, getContact } = await import("@/modules/crm/contacts"));
    ({ listDealsForPipeline, getDeal } = await import("@/modules/crm/deals"));
    ({ getLeadStats } = await import("@/modules/leads/stats"));

    const tenant = await createTenant(superadmin, { name: "Red", slug: `red-${newId()}` });
    owner = (await buildSystemTenantContext(tenant!.id))!;

    const pipeline = await seedDefaultPipeline(owner);
    pipelineId = pipeline!.id;
    const stages = await listStagesForPipeline(owner, pipelineId);

    const dentist = await createSite(owner, {
      name: "Dentista",
      slug: `dentista-${newId()}`,
      defaultPipelineId: pipelineId,
      defaultStageId: stages[0].id,
    });
    const materials = await createSite(owner, {
      name: "Materiales",
      slug: `materiales-${newId()}`,
      defaultPipelineId: pipelineId,
      defaultStageId: stages[0].id,
    });
    dentistSiteId = dentist.id;
    materialsSiteId = materials.id;

    // One lead per site, through the real ingest path so the site stamping
    // is exercised rather than faked.
    const d = await ingestLead(dentist.apiKey, {
      phone: `0981${Math.floor(100000 + Math.random() * 899999)}`,
      name: "Paciente",
      idempotency_key: `d-${newId()}`,
    });
    const m = await ingestLead(materials.apiKey, {
      phone: `0982${Math.floor(100000 + Math.random() * 899999)}`,
      name: "Constructor",
      idempotency_key: `m-${newId()}`,
    });
    if (!d.ok || !m.ok) throw new Error("ingest failed in setup");
    dentistContactId = d.result.contactId;
    materialsContactId = m.result.contactId;
    dentistDealId = d.result.dealId!;
    materialsDealId = m.result.dealId!;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  it("ingest stamps the originating site on both the contact and the deal", async () => {
    // Without this stamping there is nothing to scope on, so it is the
    // precondition for every assertion below.
    const deal = await getDeal(owner, dentistDealId);
    expect(deal!.siteId).toBe(dentistSiteId);

    const c = await getContact(owner, dentistContactId);
    expect(c!.firstSiteId).toBe(dentistSiteId);
  });

  it("the owner (unrestricted) sees both sites' leads", async () => {
    const contacts = await listContacts(owner);
    expect(contacts.some((c) => c.id === dentistContactId)).toBe(true);
    expect(contacts.some((c) => c.id === materialsContactId)).toBe(true);
  });

  it("a client restricted to dentista never sees materiales' contacts — listed or by id", async () => {
    const dentistUser = scopedTo([dentistSiteId]);

    const contacts = await listContacts(dentistUser);
    expect(contacts.some((c) => c.id === dentistContactId)).toBe(true);
    expect(contacts.some((c) => c.id === materialsContactId)).toBe(false);

    // Guessing the id must not work either.
    expect(await getContact(dentistUser, materialsContactId)).toBeNull();
    expect(await getContact(dentistUser, dentistContactId)).not.toBeNull();
  });

  it("the kanban is scoped too — a restricted user sees only their site's deals", async () => {
    const dentistUser = scopedTo([dentistSiteId]);

    const deals = await listDealsForPipeline(dentistUser, pipelineId);
    expect(deals.some((d) => d.id === dentistDealId)).toBe(true);
    expect(deals.some((d) => d.id === materialsDealId)).toBe(false);

    expect(await getDeal(dentistUser, materialsDealId)).toBeNull();
  });

  it("lead stats and the sites list are scoped", async () => {
    const dentistUser = scopedTo([dentistSiteId]);

    const stats = await getLeadStats(dentistUser);
    expect(stats.bySite.some((b) => b.key === dentistSiteId)).toBe(true);
    expect(stats.bySite.some((b) => b.key === materialsSiteId)).toBe(false);

    const sites = await listSites(dentistUser);
    expect(sites.map((s) => s.id)).toEqual([dentistSiteId]);
    expect(await getSite(dentistUser, materialsSiteId)).toBeNull();
  });

  it("an employee granted both sites sees both", async () => {
    const employee = scopedTo([dentistSiteId, materialsSiteId], "agent");

    const contacts = await listContacts(employee);
    expect(contacts.some((c) => c.id === dentistContactId)).toBe(true);
    expect(contacts.some((c) => c.id === materialsContactId)).toBe(true);
  });

  it("an empty scope sees nothing — a misconfigured client must not fall back to everything", async () => {
    const misconfigured = scopedTo([]);

    expect(await listContacts(misconfigured)).toHaveLength(0);
    expect(await listDealsForPipeline(misconfigured, pipelineId)).toHaveLength(0);
    expect(await listSites(misconfigured)).toHaveLength(0);
    expect(await getContact(misconfigured, dentistContactId)).toBeNull();
  });

  it("records with no site (created by hand in the CRM) are hidden from restricted users", async () => {
    const { createContact } = await import("@/modules/crm/contacts");
    const manual = await createContact(owner, {
      name: "Manual",
      phone: `0983${Math.floor(100000 + Math.random() * 899999)}`,
    });

    // Visible to the owner…
    expect(await getContact(owner, manual!.id)).not.toBeNull();
    // …but a site-restricted user has no basis to see it.
    expect(await getContact(scopedTo([dentistSiteId]), manual!.id)).toBeNull();
  });
});
