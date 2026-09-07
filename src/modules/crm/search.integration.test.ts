import { afterAll, beforeAll, describe, expect, it } from "vitest";

// FULLTEXT-backed ⌘K search (PLAN.md §13 H8), covering the switch away from
// `LIKE '%term%'` (migration 0028 adds the FULLTEXT indexes this exercises).
// Runs only against a real MySQL — FULLTEXT/MATCH...AGAINST has no
// meaningful fake, same hasDb convention as the other integration suites.
const hasDb = !!process.env.DATABASE_URL;

// InnoDB flushes a freshly written row into its FULLTEXT index from an
// in-memory cache rather than synchronously at commit (see the module
// comment in ./search.ts) — in testing this took anywhere from
// instantaneous to a few seconds. `expect.poll` absorbs that gap instead of
// the suite flaking on however loaded the box happens to be; the test
// timeout is raised to match so the poll isn't cut off first.
const POLL = { timeout: 8_000, interval: 100 };
const TEST_TIMEOUT = 10_000;

describe.skipIf(!hasDb)("cross-entity search (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let search: typeof import("./search");
  let contacts: typeof import("./contacts");
  let pipelines: typeof import("./pipelines");
  let deals: typeof import("./deals");
  let quotesModule: typeof import("@/modules/quotes/quotes");
  let documentsModule: typeof import("@/modules/documents/documents");
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-search-test", impersonatorUserId: null } as const;

  let ctx: TenantContext;
  let otherCtx: TenantContext;
  let contactId: string;
  let otherContactId: string;
  let pipelineId: string;
  let quoteNumber: string;
  let documentNumber: string;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    search = await import("./search");
    contacts = await import("./contacts");
    pipelines = await import("./pipelines");
    deals = await import("./deals");
    quotesModule = await import("@/modules/quotes/quotes");
    documentsModule = await import("@/modules/documents/documents");
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));

    const tenant = await createTenant(superadmin, {
      name: `Search ${newId()}`,
      slug: `search-${newId()}`,
    });
    const other = await createTenant(superadmin, {
      name: `Search Other ${newId()}`,
      slug: `search-other-${newId()}`,
    });
    ctx = (await buildSystemTenantContext(tenant!.id))!;
    otherCtx = (await buildSystemTenantContext(other!.id))!;

    const contact = await contacts.createContact(ctx, {
      name: "Fernanda Villalba",
      email: "fernanda@example.com",
      phone: `0981${Math.floor(Math.random() * 900000) + 100000}`,
    });
    contactId = contact!.id;

    // Same name in the other tenant, so a leaked match would be indistinguishable
    // from a correct one if tenant scoping were broken.
    const otherContact = await contacts.createContact(otherCtx, {
      name: "Fernanda Villalba",
      phone: `0982${Math.floor(Math.random() * 900000) + 100000}`,
    });
    otherContactId = otherContact!.id;

    const pipeline = await pipelines.createPipelineWithDefaultStages(ctx, "Ventas");
    pipelineId = pipeline!.id;
    const stages = await pipelines.listStagesForPipeline(ctx, pipelineId);
    const openStage = stages.find((s) => !s.isWon && !s.isLost)!;

    await deals.createDeal(ctx, {
      contactId,
      pipelineId,
      stageId: openStage.id,
      title: "Renovacion Anual Software",
      value: 1_000_000,
    });

    const quote = await quotesModule.createQuote(ctx, {
      contactId,
      items: [{ description: "Servicio", qty: 1, unitPrice: 100_000 }],
    });
    quoteNumber = quote!.number;

    const document = await documentsModule.createDocument(ctx, {
      contactId,
      items: [{ description: "Servicio", qty: 1, unitPrice: 100_000 }],
    });
    documentNumber = document!.number;
  });

  afterAll(async () => {
    if (!hasDb) return;
    const { db } = await import("@/db/client");
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it(
    "finds a contact by a whole word in its name",
    async () => {
      await expect
        .poll(async () => {
          const result = await search.searchTenant(ctx, "Villalba");
          return result.hits.some((hit) => hit.kind === "contact" && hit.id === contactId);
        }, POLL)
        .toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "finds a contact by email",
    async () => {
      await expect
        .poll(async () => {
          const result = await search.searchTenant(ctx, "fernanda@example.com");
          return result.hits.some((hit) => hit.kind === "contact" && hit.id === contactId);
        }, POLL)
        .toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "finds a deal by a word in its title",
    async () => {
      await expect
        .poll(async () => {
          const result = await search.searchTenant(ctx, "Renovacion");
          return result.hits.some((hit) => hit.kind === "deal");
        }, POLL)
        .toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "finds a quote by its full number",
    async () => {
      await expect
        .poll(async () => {
          const result = await search.searchTenant(ctx, quoteNumber);
          return result.hits.some((hit) => hit.kind === "quote" && hit.title === quoteNumber);
        }, POLL)
        .toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "finds a document by its full number",
    async () => {
      await expect
        .poll(async () => {
          const result = await search.searchTenant(ctx, documentNumber);
          return result.hits.some(
            (hit) => hit.kind === "document" && hit.title === documentNumber,
          );
        }, POLL)
        .toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "never returns another tenant's rows, even for a name both tenants share",
    async () => {
      await expect
        .poll(async () => {
          const mine = await search.searchTenant(ctx, "Fernanda Villalba");
          return mine.hits.some((hit) => hit.kind === "contact" && hit.id === contactId);
        }, POLL)
        .toBe(true);

      const mine = await search.searchTenant(ctx, "Fernanda Villalba");
      expect(mine.hits.every((hit) => hit.id !== otherContactId)).toBe(true);

      await expect
        .poll(async () => {
          const theirs = await search.searchTenant(otherCtx, "Fernanda Villalba");
          return theirs.hits.some((hit) => hit.kind === "contact" && hit.id === otherContactId);
        }, POLL)
        .toBe(true);

      const theirs = await search.searchTenant(otherCtx, "Fernanda Villalba");
      expect(theirs.hits.every((hit) => hit.id !== contactId)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  // FULLTEXT matching is "word starts with", not LIKE's "contains anywhere"
  // — a genuine behavior change, not merely the short-token floor. "erna"
  // sits in the middle of "Fernanda" and would have matched under the old
  // `LIKE '%erna%'` scan; the right-truncated FULLTEXT match ("erna*")
  // requires it to *begin* an indexed word, so it no longer does. No poll
  // needed here — this asserts a match never appears, so it isn't racing
  // the FULLTEXT flush.
  it("does not match a mid-word fragment the old LIKE scan would have (documented trade-off)", async () => {
    const result = await search.searchTenant(ctx, "erna");
    expect(result.hits.some((hit) => hit.kind === "contact" && hit.id === contactId)).toBe(false);
  });

  // Below the FULLTEXT token floor (innodb_ft_min_token_size, 3 by
  // default): the query has no usable word at all, so the search skips the
  // round trip entirely rather than falling through to "every row".
  it("does not match a fragment shorter than the FULLTEXT token floor (documented trade-off)", async () => {
    const result = await search.searchTenant(ctx, "an");
    expect(result.hits.some((hit) => hit.kind === "contact" && hit.id === contactId)).toBe(false);
  });

  it("still finds a contact by phone digits, unaffected by the FULLTEXT switch", async () => {
    const contact = (await contacts.getContact(ctx, contactId))!;
    const digits = contact.phone.replace(/\D/g, "").slice(-6);
    const result = await search.searchTenant(ctx, digits);
    expect(result.hits.some((hit) => hit.kind === "contact" && hit.id === contactId)).toBe(true);
  });
});
