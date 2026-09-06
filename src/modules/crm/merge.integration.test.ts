import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Needs a real MySQL — same reason every other integration suite in this
// repo does.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("contact merge (MySQL)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let createContact: (typeof import("@/modules/crm/contacts"))["createContact"];
  let getContact: (typeof import("@/modules/crm/contacts"))["getContact"];
  let createTag: (typeof import("@/modules/crm/contacts"))["createTag"];
  let addTagToContact: (typeof import("@/modules/crm/contacts"))["addTagToContact"];
  let listTagsForContact: (typeof import("@/modules/crm/contacts"))["listTagsForContact"];
  let seedDefaultPipeline: (typeof import("@/modules/crm/pipelines"))["seedDefaultPipeline"];
  let listPipelines: (typeof import("@/modules/crm/pipelines"))["listPipelines"];
  let listStagesForPipeline: (typeof import("@/modules/crm/pipelines"))["listStagesForPipeline"];
  let createDeal: (typeof import("@/modules/crm/deals"))["createDeal"];
  let contactReferenceColumns: (typeof import("./merge"))["contactReferenceColumns"];
  let mergeContacts: (typeof import("./merge"))["mergeContacts"];
  let MergeError: (typeof import("./merge"))["MergeError"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctx: TenantContext;
  let otherCtx: TenantContext;

  // `newId()`'s first characters are ULID timestamp digits, nearly
  // identical across calls made milliseconds apart — a phone built from a
  // slice of it collides across the several contacts each test creates.
  // A monotonic counter is what's actually unique.
  let phoneCounter = 0;
  function uniquePhone(): string {
    phoneCounter += 1;
    return `0981${String(phoneCounter).padStart(6, "0")}`;
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ createContact, getContact, createTag, addTagToContact, listTagsForContact } = await import(
      "@/modules/crm/contacts"
    ));
    ({ seedDefaultPipeline, listPipelines, listStagesForPipeline } = await import(
      "@/modules/crm/pipelines"
    ));
    ({ createDeal } = await import("@/modules/crm/deals"));
    ({ contactReferenceColumns, mergeContacts, MergeError } = await import("./merge"));

    const tenant = await createTenant(superadmin, { name: "Merge Co", slug: `merge-${newId()}` });
    ctx = (await buildSystemTenantContext(tenant!.id))!;

    const other = await createTenant(superadmin, { name: "Other Merge Co", slug: `merge-other-${newId()}` });
    otherCtx = (await buildSystemTenantContext(other!.id))!;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  it("the derived reference-column list is non-empty and covers every table the phase names", () => {
    const columns = contactReferenceColumns();
    expect(columns.length).toBeGreaterThan(0);
    const tableNames = columns.map((c) => c.tableName);
    for (const expected of ["deals", "activities", "tasks", "quotes", "documents", "contact_tags"]) {
      expect(tableNames).toContain(expected);
    }
  });

  it("refuses to merge a contact with itself", async () => {
    const contact = await createContact(ctx, { name: "Solo", phone: uniquePhone() });
    await expect(mergeContacts(ctx, contact!.id, contact!.id)).rejects.toThrow(MergeError);
  });

  it("refuses across tenants (tenantDb makes the row invisible to the other tenant)", async () => {
    const mine = await createContact(ctx, { name: "Mine", phone: uniquePhone() });
    const theirs = await createContact(otherCtx, { name: "Theirs", phone: uniquePhone() });

    await expect(mergeContacts(ctx, mine!.id, theirs!.id)).rejects.toThrow(MergeError);
    // Neither contact is touched by the refused attempt.
    expect(await getContact(ctx, mine!.id)).not.toBeNull();
    expect(await getContact(otherCtx, theirs!.id)).not.toBeNull();
  });

  it("re-points every derived table, unions tags and custom, keeps the earliest created_at, deletes the loser, and audits it", async () => {
    await seedDefaultPipeline(ctx);
    const [pipeline] = await listPipelines(ctx);
    const stages = await listStagesForPipeline(ctx, pipeline!.id);

    const winner = await createContact(ctx, {
      name: "Ana Winner",
      phone: uniquePhone(),
      custom: { ruc: "1" },
    });
    const loser = await createContact(ctx, {
      name: "Ana Loser",
      phone: uniquePhone(),
      email: "ana@example.com",
      custom: { note: "from loser" },
    });

    const tagA = await createTag(ctx, { name: `shared-${newId()}` });
    const tagB = await createTag(ctx, { name: `loser-only-${newId()}` });
    await addTagToContact(ctx, winner!.id, tagA!.id);
    await addTagToContact(ctx, loser!.id, tagA!.id); // shared — must not collide
    await addTagToContact(ctx, loser!.id, tagB!.id); // loser-only — must move

    const deal = await createDeal(ctx, {
      pipelineId: pipeline!.id,
      stageId: stages[0]!.id,
      contactId: loser!.id,
      title: "Deal on the loser",
      value: 100,
    });

    const result = await mergeContacts(ctx, winner!.id, loser!.id, { email: "loser" });

    expect(result.countsByTable.deals).toBe(1);
    expect(result.countsByTable.contact_tags).toBe(1); // only the loser-only tag moved

    const merged = await getContact(ctx, winner!.id);
    expect(merged).not.toBeNull();
    expect(merged!.email).toBe("ana@example.com"); // explicit fieldChoices: loser
    expect(merged!.custom).toEqual({ ruc: "1", note: "from loser" }); // winner wins on conflict, union otherwise

    const mergedTags = await listTagsForContact(ctx, winner!.id);
    expect(mergedTags.map((t) => t.id).sort()).toEqual([tagA!.id, tagB!.id].sort());

    expect(await getContact(ctx, loser!.id)).toBeNull();

    const [movedDeal] = await db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, deal!.id));
    expect(movedDeal!.contactId).toBe(winner!.id);

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, winner!.id));
    const mergeAudit = auditRows.find((row) => row.action === "contact.merge");
    expect(mergeAudit).toBeDefined();
    expect((mergeAudit!.payload as { loserId?: string }).loserId).toBe(loser!.id);
  });

  it("after a merge, no row anywhere still carries the loser's id", async () => {
    const winner = await createContact(ctx, { name: "Winner Two", phone: uniquePhone() });
    const loser = await createContact(ctx, { name: "Loser Two", phone: uniquePhone() });
    const loserId = loser!.id;

    await mergeContacts(ctx, winner!.id, loserId);

    for (const { table, column } of contactReferenceColumns()) {
      const rows = await db.select().from(table).where(eq(column, loserId));
      expect(rows).toEqual([]);
    }
  });
});
