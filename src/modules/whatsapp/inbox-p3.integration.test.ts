import { afterAll, beforeAll, describe, expect, it } from "vitest";

// P3 — inbox ergonomics (PLAN.md §15.8): list filters, message/contact
// search, quick reply variable rendering, and the opt-out guard, all against
// a real database the way inbox-assignment.integration.test.ts already does.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("inbox ergonomics (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let inbox: typeof import("./inbox");
  let quickReplies: typeof import("./quick-replies");
  let notes: typeof import("./notes");
  let actionsModule: typeof import("@/modules/automations/actions");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let ctx: TenantContext;
  let accountId: string;
  let contactAlice: { id: string };
  let contactBob: { id: string };
  let memberId: string;
  let conversationAlice: string;
  let conversationBob: string;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    inbox = await import("./inbox");
    quickReplies = await import("./quick-replies");
    notes = await import("./notes");
    actionsModule = await import("@/modules/automations/actions");
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { connectAccountManually } = await import("./accounts");
    const { createContact, addTagToContact, createTag } = await import("@/modules/crm/contacts");

    const superadmin = { userId: "sa-p3", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `P3 ${newId()}`,
      slug: `p3-${newId()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };

    memberId = newId();
    await db.insert(schema.users).values({
      id: memberId,
      tenantId: ctx.tenantId,
      email: `member-${memberId}@example.com`,
      name: "Rep",
      role: "agent",
    });
    await db.insert(schema.tenantMemberships).values({
      id: newId(),
      tenantId: ctx.tenantId,
      userId: memberId,
      role: "agent",
    });

    const account = await connectAccountManually(ctx, {
      wabaId: `waba-${newId()}`,
      phoneNumberId: `pn-${newId()}`,
      accessToken: "token",
    });
    accountId = account.id;

    contactAlice = (await createContact(ctx, { name: "Alice Gomez", phone: "+595981000222" }))!;
    contactBob = (await createContact(ctx, { name: "Bob Duarte", phone: "+595981000333" }))!;

    const optoutTag = await createTag(ctx, { name: "optout" });
    await addTagToContact(ctx, contactBob.id, optoutTag!.id);

    conversationAlice = (await inbox.getOrCreateConversation(ctx, accountId, contactAlice.id)).id;
    conversationBob = (await inbox.getOrCreateConversation(ctx, accountId, contactBob.id)).id;
  });

  it("filters by mine, unassigned, and unread", async () => {
    await inbox.assignConversation(ctx, conversationAlice, memberId);

    const mine = await inbox.listConversations({ ...ctx, userId: memberId }, { filter: "mine" });
    expect(mine.map((c) => c.id)).toContain(conversationAlice);
    expect(mine.map((c) => c.id)).not.toContain(conversationBob);

    const unassigned = await inbox.listConversations(ctx, { filter: "unassigned" });
    expect(unassigned.map((c) => c.id)).toContain(conversationBob);
    expect(unassigned.map((c) => c.id)).not.toContain(conversationAlice);

    await inbox.markConversationUnread(ctx, conversationBob);
    const unread = await inbox.listConversations(ctx, { filter: "unread" });
    expect(unread.map((c) => c.id)).toContain(conversationBob);
  });

  it("searches by contact name and phone", async () => {
    const byName = await inbox.searchConversations(ctx, "Alice");
    expect(byName.map((c) => c.id)).toContain(conversationAlice);

    const byPhone = await inbox.searchConversations(ctx, "000333");
    expect(byPhone.map((c) => c.id)).toContain(conversationBob);
  });

  it("renders the contact-name variable in a quick reply", async () => {
    const reply = await quickReplies.createQuickReply(ctx, {
      name: "Bienvenida",
      body: "Hola {{contacto.nombre}}, gracias por escribirnos.",
    });

    const rendered = quickReplies.renderQuickReply(reply!.body, { name: "Alice Gomez" });
    expect(rendered).toBe("Hola Alice Gomez, gracias por escribirnos.");
  });

  it("a note is never a messages row, and shows up on the contact timeline", async () => {
    const before = await inbox.listMessagesForConversation(ctx, conversationAlice);

    await notes.addNote(ctx, {
      conversationId: conversationAlice,
      contactId: contactAlice.id,
      body: "Prefiere que la llamemos después de las 18h.",
    });

    const after = await inbox.listMessagesForConversation(ctx, conversationAlice);
    expect(after.length).toBe(before.length);

    const forConversation = await notes.listNotesForConversation(ctx, conversationAlice);
    expect(forConversation).toHaveLength(1);

    const { getContactTimeline } = await import("@/modules/crm/timeline");
    const timeline = await getContactTimeline(ctx, contactAlice.id);
    expect(timeline.some((entry) => entry.kind === "conversationNote")).toBe(true);
  });

  it("flags a tagged-optout contact for the manual-send confirm", async () => {
    expect(await actionsModule.hasOptedOut(ctx, contactBob.id)).toBe(true);
    expect(await actionsModule.hasOptedOut(ctx, contactAlice.id)).toBe(false);
  });
});
