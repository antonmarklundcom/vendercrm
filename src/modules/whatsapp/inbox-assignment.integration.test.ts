import { afterAll, beforeAll, describe, expect, it } from "vitest";

// What assignConversation promises that only a real database can show: the
// owner it writes is always an active member of the caller's own tenant.
// `conversations.assignedUserId` has no foreign key (§4 has none), and
// tenantDb scopes the conversation row without looking at the user id in the
// payload — so the check has to be its own, and has to be tested against
// rows that really exist. Same harness as the other integration suites.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("assigning a conversation (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let inbox: typeof import("./inbox");
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let ctx: TenantContext;
  let otherCtx: TenantContext;
  let conversationId: string;
  let memberId: string;
  let bannedMemberId: string;
  let outsiderId: string;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    inbox = await import("./inbox");
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { connectAccountManually } = await import("./accounts");
    const { createContact } = await import("@/modules/crm/contacts");

    const superadmin = { userId: "sa-assign", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Assign ${newId()}`,
      slug: `assign-${newId()}`,
    });
    const other = await createTenant(superadmin, {
      name: `Outsider ${newId()}`,
      slug: `outsider-${newId()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
    otherCtx = { ...ctx, tenantId: other!.id };

    memberId = newId();
    bannedMemberId = newId();
    outsiderId = newId();
    await db.insert(schema.users).values([
      {
        id: memberId,
        tenantId: ctx.tenantId,
        email: `member-${memberId}@example.com`,
        name: "Rep Activa",
        role: "agent",
      },
      {
        id: bannedMemberId,
        tenantId: ctx.tenantId,
        email: `banned-${bannedMemberId}@example.com`,
        name: "Rep Desactivada",
        role: "agent",
        banned: true,
      },
      {
        id: outsiderId,
        tenantId: otherCtx.tenantId,
        email: `outsider-${outsiderId}@example.com`,
        name: "Otro Tenant",
        role: "agent",
      },
    ]);

    const account = await connectAccountManually(ctx, {
      wabaId: `waba-${newId()}`,
      phoneNumberId: `pn-${newId()}`,
      accessToken: "token",
    });
    const contact = await createContact(ctx, { name: "Cliente", phone: "+595981000111" });
    const conversation = await inbox.getOrCreateConversation(ctx, account.id, contact.id);
    conversationId = conversation.id;
  });

  it("gives the conversation to a member of the tenant", async () => {
    await inbox.assignConversation(ctx, conversationId, memberId);

    const stored = await inbox.getConversation(ctx, conversationId);
    expect(stored?.assignedUserId).toBe(memberId);
  });

  it("clears the owner when nobody is chosen", async () => {
    await inbox.assignConversation(ctx, conversationId, memberId);
    await inbox.assignConversation(ctx, conversationId, null);

    const stored = await inbox.getConversation(ctx, conversationId);
    expect(stored?.assignedUserId).toBeNull();
  });

  it("refuses a user from another tenant, and changes nothing", async () => {
    await inbox.assignConversation(ctx, conversationId, memberId);

    await expect(inbox.assignConversation(ctx, conversationId, outsiderId)).rejects.toMatchObject({
      code: "userNotFound",
    });

    const stored = await inbox.getConversation(ctx, conversationId);
    expect(stored?.assignedUserId).toBe(memberId);
  });

  it("refuses a deactivated member — an unread queue nobody is reading", async () => {
    await expect(
      inbox.assignConversation(ctx, conversationId, bannedMemberId),
    ).rejects.toMatchObject({ code: "userNotFound" });
  });

  it("refuses a user id that does not exist at all", async () => {
    await expect(inbox.assignConversation(ctx, conversationId, newId())).rejects.toMatchObject({
      code: "userNotFound",
    });
  });
});
