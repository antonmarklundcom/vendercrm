import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Replying from the Inbox (PLAN-EMAIL.md E4) against MySQL, with the
// platform switch forced on and a recording provider in place of Cloudflare.

vi.mock("@/modules/tenancy/mailbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/tenancy/mailbox")>()),
  isMailboxAvailable: vi.fn(async () => true),
}));

const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("mailbox reply (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  type ProviderMessage = import("@/lib/email/providers").ProviderMessage;

  let ctx: TenantContext;
  let threadId: string;
  let inboundMessageId: string;
  let reply: typeof import("./reply");
  let threads: typeof import("./threads");
  const sent: ProviderMessage[] = [];
  const provider = {
    name: "cloudflare" as const,
    send: vi.fn(async (message: ProviderMessage) => {
      sent.push(message);
      return { ok: true as const };
    }),
  };

  beforeAll(async () => {
    reply = await import("./reply");
    threads = await import("./threads");
    const { newId } = await import("@/lib/ids");
    const { storage } = await import("@/lib/storage");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");
    const { createMailbox } = await import("./mailboxes");
    const { ingestInboundEmail } = await import("./ingest");

    const superadmin = { userId: "sa-e4", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, { name: "E4", slug: `e4-${newId()}`.toLowerCase() });
    ctx = { ...(await buildSystemTenantContext(tenant!.id))!, userId: "system", accessStatus: "active" };
    const domain = `e4-${newId().slice(-8).toLowerCase()}.com.py`;
    const mailbox = await createMailbox(ctx, { address: `ventas@${domain}`, displayName: 'Tienda "E4"' });

    const base = `email-inbound/test/${newId()}`;
    await storage.put(`${base}/raw.eml`, Buffer.from("x"));
    inboundMessageId = `${newId()}@example.com`;
    const stored = await ingestInboundEmail(ctx, mailbox!, {
      version: 1,
      envelopeTo: `ventas@${domain}`,
      envelopeFrom: null,
      messageId: `<${inboundMessageId}>`,
      inReplyTo: null,
      references: ["<first@example.com>"],
      subject: "Presupuesto",
      date: null,
      from: { address: "ana@example.com", name: "Ana" },
      to: [],
      cc: [],
      replyTo: [{ address: "ana.compras@example.com", name: null }],
      text: "Hola",
      html: null,
      rawKey: `${base}/raw.eml`,
      rawSize: 1,
      attachments: [],
    });
    threadId = stored.threadId;
  });

  it("sends from the mailbox to the Reply-To, with threading headers, and stores it", async () => {
    const result = await reply.sendThreadReply(
      ctx,
      { threadId, body: "Hola Ana,\n\nTe paso <el> precio." },
      { provider },
    );
    expect(result.ok).toBe(true);

    const message = sent.at(-1)!;
    expect(message.from).toMatch(/^"Tienda \\"E4\\"" <ventas@e4-[a-z0-9]+\.com\.py>$/);
    expect(message.to).toBe("ana.compras@example.com");
    expect(message.subject).toBe("Re: Presupuesto");
    expect(message.headers?.["In-Reply-To"]).toBe(`<${inboundMessageId}>`);
    expect(message.headers?.References).toBe(`<first@example.com> <${inboundMessageId}>`);
    expect(message.html).toContain("Te paso &lt;el&gt; precio.");
    expect(message.text).toContain("Te paso <el> precio.");

    const stored = (await threads.listThreadMessages(ctx, threadId)).find((m) => m.direction === "out")!;
    expect(stored.status).toBe("sent");
    expect(message.headers?.["X-VenderCRM-Message-Id"]).toBe(stored.messageId);
    expect((await threads.getThread(ctx, threadId))?.unread).toBe(false);
  });

  it("refuses more than five recipients, bad addresses and empty bodies", async () => {
    const cc = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"];
    expect(await reply.sendThreadReply(ctx, { threadId, body: "x", cc }, { provider })).toEqual({
      ok: false,
      error: "too_many_recipients",
    });
    expect(
      await reply.sendThreadReply(ctx, { threadId, body: "x", cc: ["no-es-correo"] }, { provider }),
    ).toEqual({ ok: false, error: "invalid_recipient" });
    expect(await reply.sendThreadReply(ctx, { threadId, body: "   " }, { provider })).toEqual({
      ok: false,
      error: "empty",
    });
    const okFour = await reply.sendThreadReply(ctx, { threadId, body: "x", cc: cc.slice(0, 4) }, { provider });
    expect(okFour.ok).toBe(true);
  });

  it("records a failed send and honours a guard and a suspension", async () => {
    const failing = { name: "cloudflare" as const, send: vi.fn(async () => ({ ok: false as const })) };
    expect(await reply.sendThreadReply(ctx, { threadId, body: "x" }, { provider: failing })).toEqual({
      ok: false,
      error: "send_failed",
    });
    const messages = await threads.listThreadMessages(ctx, threadId);
    expect(messages.some((m) => m.direction === "out" && m.status === "failed")).toBe(true);

    const guard = vi.fn(async () => "send_failed" as const);
    const before = provider.send.mock.calls.length;
    expect((await reply.sendThreadReply(ctx, { threadId, body: "x" }, { provider, guard })).ok).toBe(false);
    expect(provider.send.mock.calls.length).toBe(before);

    const { eq } = await import("drizzle-orm");
    const { db } = await import("@/db/client");
    const { tenants } = await import("@/db/schema");
    await db.update(tenants).set({ outboundSuspendedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
    expect(await reply.sendThreadReply(ctx, { threadId, body: "x" }, { provider })).toEqual({
      ok: false,
      error: "suspended",
    });
    await db.update(tenants).set({ outboundSuspendedAt: null }).where(eq(tenants.id, ctx.tenantId));
  });

  it("creates a contact from the thread, or links the one with that phone", async () => {
    const { createContactFromThread } = await import("./link");
    const { getContact } = await import("@/modules/crm/contacts");
    const phone = `+59598${Math.floor(Math.random() * 1e7).toString().padStart(7, "0")}`;
    const created = await createContactFromThread(ctx, threadId, { name: "Ana", phone });
    expect("contactId" in created).toBe(true);
    if (!("contactId" in created)) return;
    const contact = await getContact(ctx, created.contactId);
    expect(contact).toMatchObject({ email: "ana@example.com", source: "email", phone });
    expect((await threads.getThread(ctx, threadId))?.contactId).toBe(created.contactId);

    const again = await createContactFromThread(ctx, threadId, { name: "Otra", phone });
    expect(again).toEqual({ contactId: created.contactId });
    expect(await createContactFromThread(ctx, threadId, { name: "x", phone: "12" })).toEqual({ error: "invalid" });
  });
});
