import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Every rule reads across several tenant-scoped tables, so this suite needs
// real MySQL — same convention as the other DB-backed suites in this repo.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("buildHoy (MySQL)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let createContact: (typeof import("@/modules/crm/contacts"))["createContact"];
  let createTask: (typeof import("@/modules/crm/tasks"))["createTask"];
  let createDeal: (typeof import("@/modules/crm/deals"))["createDeal"];
  let seedDefaultPipeline: (typeof import("@/modules/crm/pipelines"))["seedDefaultPipeline"];
  let listStagesForPipeline: (typeof import("@/modules/crm/pipelines"))["listStagesForPipeline"];
  let updateStage: (typeof import("@/modules/crm/pipelines"))["updateStage"];
  let createQuote: (typeof import("@/modules/quotes/quotes"))["createQuote"];
  let setQuoteStatus: (typeof import("@/modules/quotes/quotes"))["setQuoteStatus"];
  let getOrCreateConversation: (typeof import("@/modules/whatsapp/inbox"))["getOrCreateConversation"];
  let connectAccountManually: (typeof import("@/modules/whatsapp/accounts"))["connectAccountManually"];
  let buildHoy: (typeof import("./hoy"))["buildHoy"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;
  const NOW = new Date("2026-06-15T15:00:00.000Z");

  let ctx: TenantContext;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ createContact } = await import("@/modules/crm/contacts"));
    ({ createTask } = await import("@/modules/crm/tasks"));
    ({ createDeal } = await import("@/modules/crm/deals"));
    ({ seedDefaultPipeline, listStagesForPipeline, updateStage } = await import(
      "@/modules/crm/pipelines"
    ));
    ({ createQuote, setQuoteStatus } = await import("@/modules/quotes/quotes"));
    ({ getOrCreateConversation } = await import("@/modules/whatsapp/inbox"));
    ({ connectAccountManually } = await import("@/modules/whatsapp/accounts"));
    ({ buildHoy } = await import("./hoy"));

    const tenant = await createTenant(superadmin, { name: "Hoy Co", slug: `hoy-${newId()}` });
    ctx = (await buildSystemTenantContext(tenant!.id))!;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  let phoneCounter = 0;
  async function newContact(name: string) {
    phoneCounter += 1;
    return (await createContact(ctx, { name, phone: `0981${String(phoneCounter).padStart(6, "0")}` }))!;
  }

  it("flags an unread conversation whose last inbound message is over an hour old", async () => {
    const contact = await newContact("Conversación Vieja");
    const account = await connectAccountManually(ctx, {
      wabaId: `waba-${newId()}`,
      phoneNumberId: `phone-${newId()}`,
      accessToken: "token",
    });
    const conversation = await getOrCreateConversation(ctx, account!.id, contact.id);
    await db
      .update(schema.conversations)
      .set({ unreadCount: 1, lastInboundAt: new Date(NOW.getTime() - 90 * 60 * 1000) })
      .where(eq(schema.conversations.id, conversation.id));

    const items = await buildHoy(ctx, NOW);
    const item = items.find((i) => i.kind === "unread_conversation" && i.url === `/inbox/${conversation.id}`);
    expect(item).toBeTruthy();
    expect(item!.title).toContain("Conversación Vieja");
  });

  it("does not flag a conversation answered within the last hour", async () => {
    const contact = await newContact("Conversación Reciente");
    const account = await connectAccountManually(ctx, {
      wabaId: `waba-${newId()}`,
      phoneNumberId: `phone-${newId()}`,
      accessToken: "token",
    });
    const conversation = await getOrCreateConversation(ctx, account!.id, contact.id);
    await db
      .update(schema.conversations)
      .set({ unreadCount: 1, lastInboundAt: new Date(NOW.getTime() - 5 * 60 * 1000) })
      .where(eq(schema.conversations.id, conversation.id));

    const items = await buildHoy(ctx, NOW);
    expect(items.some((i) => i.url === `/inbox/${conversation.id}`)).toBe(false);
  });

  it("flags a deal sitting past its stage's stale_after_days", async () => {
    const pipeline = await seedDefaultPipeline(ctx);
    const [openStage] = await listStagesForPipeline(ctx, pipeline!.id);
    await updateStage(ctx, openStage.id, { staleAfterDays: 5 });

    const contact = await newContact("Negocio Viejo");
    const deal = await createDeal(ctx, {
      contactId: contact.id,
      pipelineId: pipeline!.id,
      stageId: openStage.id,
      title: "Instalación split",
    });
    await db
      .update(schema.deals)
      .set({ stageEnteredAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.deals.id, deal!.id));

    const items = await buildHoy(ctx, NOW);
    expect(items.some((i) => i.kind === "stale_deal" && i.url === `/pipeline/${deal!.id}`)).toBe(true);
  });

  it("does not flag a deal in a won/lost stage, however long it has sat there", async () => {
    const pipeline = await seedDefaultPipeline(ctx);
    const stages = await listStagesForPipeline(ctx, pipeline!.id);
    const wonStage = stages.find((s) => s.isWon)!;

    const contact = await newContact("Negocio Ganado");
    const deal = await createDeal(ctx, {
      contactId: contact.id,
      pipelineId: pipeline!.id,
      stageId: wonStage.id,
      title: "Ya cerrado",
    });
    await db
      .update(schema.deals)
      .set({ stageEnteredAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.deals.id, deal!.id));

    const items = await buildHoy(ctx, NOW);
    expect(items.some((i) => i.url === `/pipeline/${deal!.id}`)).toBe(false);
  });

  it("flags a quote sent 3+ days ago with no reply and no open task", async () => {
    const contact = await newContact("Presupuesto Frío");
    const quote = await createQuote(ctx, {
      contactId: contact.id,
      items: [{ description: "Servicio", qty: 1, unitPrice: 100000 }],
    });
    await setQuoteStatus(ctx, quote!.id, "sent");
    await db
      .update(schema.quotes)
      .set({ sentAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.quotes.id, quote!.id));

    const items = await buildHoy(ctx, NOW);
    expect(items.some((i) => i.kind === "unreplied_quote" && i.url === `/quotes/${quote!.id}`)).toBe(
      true,
    );
  });

  it("does not flag a stale quote once an open task exists for that contact", async () => {
    const contact = await newContact("Presupuesto Con Tarea");
    const quote = await createQuote(ctx, {
      contactId: contact.id,
      items: [{ description: "Servicio", qty: 1, unitPrice: 100000 }],
    });
    await setQuoteStatus(ctx, quote!.id, "sent");
    await db
      .update(schema.quotes)
      .set({ sentAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.quotes.id, quote!.id));
    await createTask(ctx, { contactId: contact.id, title: "Llamar", dueAt: NOW });

    const items = await buildHoy(ctx, NOW);
    expect(items.some((i) => i.url === `/quotes/${quote!.id}`)).toBe(false);
  });

  it("flags a lead received in the last 48h with no deal, and stops after the window", async () => {
    const fresh = await newContact("Lead Fresco");
    await db.insert(schema.leadSubmissions).values({
      id: newId(),
      tenantId: ctx.tenantId,
      contactId: fresh.id,
      payload: {},
      utm: {},
      createdAt: new Date(NOW.getTime() - 10 * 60 * 60 * 1000),
    });

    const stale = await newContact("Lead Viejo");
    await db.insert(schema.leadSubmissions).values({
      id: newId(),
      tenantId: ctx.tenantId,
      contactId: stale.id,
      payload: {},
      utm: {},
      createdAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000),
    });

    const items = await buildHoy(ctx, NOW);
    expect(items.some((i) => i.kind === "lead_without_deal" && i.url === `/contacts/${fresh.id}`)).toBe(
      true,
    );
    expect(items.some((i) => i.url === `/contacts/${stale.id}`)).toBe(false);
  });

  it("flags a confirmed booking in the next 24h with no reminder sent", async () => {
    const contact = await newContact("Turno Mañana");
    const calendarEventId = newId();
    await db.insert(schema.bookings).values({
      id: newId(),
      tenantId: ctx.tenantId,
      bookingTypeId: newId(),
      resourceId: newId(),
      contactId: contact.id,
      calendarEventId,
      startsAt: new Date(NOW.getTime() + 3 * 60 * 60 * 1000),
      endsAt: new Date(NOW.getTime() + 4 * 60 * 60 * 1000),
      status: "confirmed",
      publicToken: newId(),
    });

    const items = await buildHoy(ctx, NOW);
    const item = items.find((i) => i.kind === "upcoming_booking");
    expect(item).toBeTruthy();
    expect(item!.url).toBe(`/calendar/${calendarEventId}`);
    expect(item!.title).toContain("Turno Mañana");
  });

  it("does not flag a booking that already has a reminder recorded", async () => {
    const contact = await newContact("Turno Con Recordatorio");
    await db.insert(schema.bookings).values({
      id: newId(),
      tenantId: ctx.tenantId,
      bookingTypeId: newId(),
      resourceId: newId(),
      contactId: contact.id,
      calendarEventId: newId(),
      startsAt: new Date(NOW.getTime() + 3 * 60 * 60 * 1000),
      endsAt: new Date(NOW.getTime() + 4 * 60 * 60 * 1000),
      status: "confirmed",
      reminderSentAt: NOW,
      publicToken: newId(),
    });

    const items = await buildHoy(ctx, NOW);
    expect(items.some((i) => i.title.includes("Turno Con Recordatorio"))).toBe(false);
  });

  it("flags an overdue task and links to its contact", async () => {
    const contact = await newContact("Tarea Vencida");
    const task = await createTask(ctx, {
      contactId: contact.id,
      title: "Confirmar visita",
      dueAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
    });

    const items = await buildHoy(ctx, NOW);
    const item = items.find((i) => i.kind === "overdue_task" && i.url === `/contacts/${contact.id}`);
    expect(item).toBeTruthy();
    expect(item!.title).toContain(task!.title);
  });

  it("the mine filter only returns items assigned to that user", async () => {
    const pipeline = await seedDefaultPipeline(ctx);
    const [openStage] = await listStagesForPipeline(ctx, pipeline!.id);
    await updateStage(ctx, openStage.id, { staleAfterDays: 1 });

    const mineContact = await newContact("Mío");
    const mineDeal = await createDeal(ctx, {
      contactId: mineContact.id,
      pipelineId: pipeline!.id,
      stageId: openStage.id,
      title: "Mi negocio",
      assignedUserId: "user-mine",
    });
    await db
      .update(schema.deals)
      .set({ stageEnteredAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.deals.id, mineDeal!.id));

    const otherContact = await newContact("De Otro");
    const otherDeal = await createDeal(ctx, {
      contactId: otherContact.id,
      pipelineId: pipeline!.id,
      stageId: openStage.id,
      title: "Otro negocio",
      assignedUserId: "user-other",
    });
    await db
      .update(schema.deals)
      .set({ stageEnteredAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.deals.id, otherDeal!.id));

    const items = await buildHoy(ctx, NOW, { mine: "user-mine" });
    expect(items.some((i) => i.url === `/pipeline/${mineDeal!.id}`)).toBe(true);
    expect(items.some((i) => i.url === `/pipeline/${otherDeal!.id}`)).toBe(false);
  });
});
