import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Needs a real MySQL — the unique index on contract_acceptances.contract_id
// is exactly what backstops the "decided exactly once" guarantee under test,
// same reason quotes/public.test.ts requires it.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("contracts lifecycle (MySQL)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let createContact: (typeof import("@/modules/crm/contacts"))["createContact"];
  let createCustomFieldDefinition: (typeof import("@/modules/crm/custom-fields"))["createCustomFieldDefinition"];
  let contracts: typeof import("./contracts");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctx: TenantContext;
  let otherCtx: TenantContext;
  let contactId: string;
  let templateId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ createContact } = await import("@/modules/crm/contacts"));
    ({ createCustomFieldDefinition } = await import("@/modules/crm/custom-fields"));
    contracts = await import("./contracts");

    // Wires contractEvents -> automations/triggers.ts -> the
    // `automation.trigger` job, the same side-effect import the worker does
    // at boot (jobs.ts).
    await import("@/modules/automations/jobs");

    const tenant = await createTenant(superadmin, {
      name: "Contract Co",
      slug: `contract-${newId()}`,
    });
    ctx = (await buildSystemTenantContext(tenant!.id))!;

    const other = await createTenant(superadmin, {
      name: "Other Co",
      slug: `contract-other-${newId()}`,
    });
    otherCtx = (await buildSystemTenantContext(other!.id))!;

    await createCustomFieldDefinition(ctx, { key: "ruc", label: "RUC", type: "text" });

    contactId = (await createContact(ctx, {
      name: "Ana Cliente",
      phone: `0981${newId().slice(0, 6)}`,
      custom: { ruc: "12345-6" },
    }))!.id;

    const template = await contracts.createContractTemplate(ctx, {
      name: "Servicio",
      body: "# Contrato\n\nCliente: {{contacto.nombre}} ({{contacto.telefono}}) RUC {{contacto.custom.ruc}}",
    });
    templateId = template.id;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  it("refuses a template that references an unknown variable, naming it", async () => {
    await expect(
      contracts.createContractTemplate(ctx, {
        name: "Malo",
        body: "Hola {{negocio.nombre}}",
      }),
    ).rejects.toMatchObject({ variable: "negocio.nombre" });
  });

  it("full lifecycle: draft -> sent -> accepted, PDF hash recorded, trigger fired, deal referenced", async () => {
    const dealId = newId();
    const contract = await contracts.createContract(ctx, { templateId, contactId, dealId });
    expect(contract.status).toBe("draft");
    expect(contract.renderedBody).toContain("Ana Cliente");
    expect(contract.renderedBody).toContain("RUC 12345-6");

    await contracts.sendContract(ctx, contract.id);
    const sent = await contracts.getContract(ctx, contract.id);
    expect(sent!.status).toBe("sent");
    expect(sent!.sentAt).not.toBeNull();

    const shownPdf = await contracts.generateContractPdf(ctx, contract.id);
    const outcome = await contracts.decideContract(sent!.publicToken, {
      decision: "accepted",
      nameTyped: "Ana Cliente",
      pdfBytes: shownPdf,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.contract.status).toBe("accepted");
    expect(outcome.contract.signedPdfStorageKey).not.toBeNull();

    const [acceptance] = await db
      .select()
      .from(schema.contractAcceptances)
      .where(eq(schema.contractAcceptances.contractId, contract.id));
    expect(acceptance.pdfSha256).toBe(createHash("sha256").update(shownPdf).digest("hex"));
    expect(acceptance.nameTyped).toBe("Ana Cliente");

    // The listener in modules/automations/triggers.ts turns the emitted
    // `contract.accepted` event into a queued `automation.trigger` job —
    // proof the trigger actually fired, without needing the worker running.
    const fired = await db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.type, "automation.trigger"), eq(schema.jobs.tenantId, ctx.tenantId)));
    expect(
      fired.some(
        (job) =>
          (job.payload as { triggerType?: string; data?: { dealId?: string } }).triggerType ===
            "contract_accepted" &&
          (job.payload as { data?: { dealId?: string } }).data?.dealId === dealId,
      ),
    ).toBe(true);
  });

  it("refuses a second decision on the same contract, whichever direction", async () => {
    const contract = await contracts.createContract(ctx, { templateId, contactId });
    await contracts.sendContract(ctx, contract.id);
    const sent = await contracts.getContract(ctx, contract.id);
    const pdf = await contracts.generateContractPdf(ctx, contract.id);

    const first = await contracts.decideContract(sent!.publicToken, {
      decision: "declined",
      nameTyped: "Primero",
      pdfBytes: pdf,
    });
    expect(first.ok).toBe(true);

    const second = await contracts.decideContract(sent!.publicToken, {
      decision: "accepted",
      nameTyped: "Segundo",
      pdfBytes: pdf,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("alreadyDecided");

    const row = await contracts.getContract(ctx, contract.id);
    expect(row!.status).toBe("declined");
  });

  it("refuses a decision on a draft (never sent) contract, or an unknown token", async () => {
    const draft = await contracts.createContract(ctx, { templateId, contactId });
    const pdf = await contracts.generateContractPdf(ctx, draft.id);

    const outcome = await contracts.decideContract(draft.publicToken, {
      decision: "accepted",
      nameTyped: "Nadie",
      pdfBytes: pdf,
    });
    expect(outcome).toEqual({ ok: false, reason: "notSent" });

    const invalid = await contracts.decideContract("not-a-real-token", {
      decision: "accepted",
      nameTyped: "Nadie",
      pdfBytes: pdf,
    });
    expect(invalid).toEqual({ ok: false, reason: "invalid" });
  });

  it("a voided contract's public token stops resolving", async () => {
    const contract = await contracts.createContract(ctx, { templateId, contactId });
    await contracts.sendContract(ctx, contract.id);
    await contracts.voidContract(ctx, contract.id, "Cliente se arrepintió");

    const resolved = await contracts.getContractByPublicToken(contract.publicToken);
    expect(resolved).toBeNull();
  });

  it("isolates contracts per tenant", async () => {
    const contract = await contracts.createContract(ctx, { templateId, contactId });
    expect(await contracts.getContract(otherCtx, contract.id)).toBeNull();
    expect(await contracts.listContracts(otherCtx)).toEqual([]);
  });
});
