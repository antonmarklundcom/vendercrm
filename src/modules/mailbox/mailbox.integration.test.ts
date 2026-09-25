import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Mailbox routing, ingest, threading and tenant isolation (PLAN-EMAIL.md
// E2/E3) against a real MySQL and the local storage driver. Skipped without
// DATABASE_URL, like the other integration suites.

const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("mailbox (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  type InboundPayload = import("./payload").InboundPayload;

  let mailboxes: typeof import("./mailboxes");
  let threads: typeof import("./threads");
  let ingest: typeof import("./ingest");
  let storage: (typeof import("@/lib/storage"))["storage"];
  let newId: (typeof import("@/lib/ids"))["newId"];

  const superadmin = { userId: "sa-e3", impersonatorUserId: null } as const;
  let ctxA: TenantContext;
  let ctxB: TenantContext;
  let domainA: string;
  let mailboxA: import("./mailboxes").MailboxRow;

  async function payloadFor(overrides: Partial<InboundPayload> = {}): Promise<InboundPayload> {
    const base = `email-inbound/test/${newId()}`;
    await storage.put(`${base}/raw.eml`, Buffer.from("From: x\r\n\r\nhola"));
    await storage.put(`${base}/att-0`, Buffer.from("%PDF-1.4"));
    return {
      version: 1,
      envelopeTo: `contacto@${domainA}`,
      envelopeFrom: null,
      messageId: `<${newId()}@example.com>`,
      inReplyTo: null,
      references: [],
      subject: "Presupuesto",
      date: new Date().toUTCString(),
      from: { address: "ana@example.com", name: "Ana" },
      to: [{ address: `contacto@${domainA}`, name: null }],
      cc: [],
      replyTo: [],
      text: "Hola",
      html: '<p onclick="x()">Hola</p><img src="https://t.example/p.gif">',
      rawKey: `${base}/raw.eml`,
      rawSize: 20,
      attachments: [
        { key: `${base}/att-0`, filename: "cotización.pdf", mimeType: "application/pdf", size: 8, contentId: null },
      ],
      ...overrides,
    };
  }

  beforeAll(async () => {
    mailboxes = await import("./mailboxes");
    threads = await import("./threads");
    ingest = await import("./ingest");
    ({ storage } = await import("@/lib/storage"));
    ({ newId } = await import("@/lib/ids"));
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");
    const { setMailboxEnabled } = await import("@/modules/tenancy/mailbox");

    const a = await createTenant(superadmin, { name: "Tienda A", slug: `e3a-${newId()}`.toLowerCase() });
    const b = await createTenant(superadmin, { name: "Tienda B", slug: `e3b-${newId()}`.toLowerCase() });
    // A trial tenant without a subscription may not be writable; the
    // system context is what the webhook uses, so force "active" here.
    ctxA = { ...(await buildSystemTenantContext(a!.id))!, accessStatus: "active" };
    ctxB = { ...(await buildSystemTenantContext(b!.id))!, accessStatus: "active" };
    await setMailboxEnabled(superadmin, a!.id, true);

    domainA = `tienda-${newId().slice(-8).toLowerCase()}.com.py`;
    mailboxA = (await mailboxes.createMailbox(ctxA, {
      address: `Contacto@${domainA}`,
      displayName: "Tienda A",
    }))!;
  });

  it("creates addresses lowercased and keeps a domain to one business", async () => {
    expect(mailboxA.address).toBe(`contacto@${domainA}`);
    expect(mailboxA.domain).toBe(domainA);
    await expect(mailboxes.createMailbox(ctxA, { address: `contacto@${domainA}` })).rejects.toMatchObject({
      code: "address_taken",
    });
    await expect(mailboxes.createMailbox(ctxB, { address: `otro@${domainA}` })).rejects.toMatchObject({
      code: "domain_taken",
    });
    await expect(mailboxes.createMailbox(ctxA, { address: "no es correo" })).rejects.toMatchObject({
      code: "invalid_address",
    });
  });

  it("routes exact addresses, catch-alls, and nothing for switched-off businesses", async () => {
    expect((await mailboxes.resolveRecipient(`CONTACTO@${domainA}`))?.tenantId).toBe(ctxA.tenantId);
    expect(await mailboxes.resolveRecipient(`ventas@${domainA}`)).toBeNull();

    const catchAll = await mailboxes.createMailbox(ctxA, { address: `info@${domainA}`, isCatchAll: true });
    expect((await mailboxes.resolveRecipient(`ventas@${domainA}`))?.mailbox.id).toBe(catchAll!.id);
    await mailboxes.deactivateMailbox(ctxA, catchAll!.id);
    expect(await mailboxes.resolveRecipient(`ventas@${domainA}`)).toBeNull();

    const domainB = `b-${newId().slice(-8).toLowerCase()}.com`;
    await mailboxes.createMailbox(ctxB, { address: `hola@${domainB}` });
    // Tenant B never had the mailbox switched on.
    expect(await mailboxes.resolveRecipient(`hola@${domainB}`)).toBeNull();
  });

  it("stores a message, its thread and attachment, and moves the files under the tenant", async () => {
    const payload = await payloadFor();
    const result = await ingest.ingestInboundEmail(ctxA, mailboxA, payload);
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;

    const thread = await threads.getThread(ctxA, result.threadId);
    expect(thread).toMatchObject({ participantEmail: "ana@example.com", unread: true, status: "open" });

    const [message] = await threads.listThreadMessages(ctxA, result.threadId);
    expect(message.direction).toBe("in");
    expect(message.htmlBody).not.toContain("onclick");
    expect(message.htmlBody).toContain("data-remote-src");
    expect(message.rawKey).toBe(`email/${ctxA.tenantId}/${message.id}/raw.eml`);

    const [attachment] = await threads.listAttachmentsForMessages(ctxA, [message.id]);
    expect(attachment.filename).toBe("cotización.pdf");
    expect((await storage.get(attachment.storageKey)).toString()).toBe("%PDF-1.4");
    await expect(storage.get(payload.rawKey)).rejects.toThrow();
  });

  it("is idempotent on Message-ID", async () => {
    const payload = await payloadFor();
    const first = await ingest.ingestInboundEmail(ctxA, mailboxA, payload);
    const again = await ingest.ingestInboundEmail(ctxA, mailboxA, { ...(await payloadFor()), messageId: payload.messageId });
    expect(again.status).toBe("duplicate");
    expect(again.emailMessageId).toBe(first.emailMessageId);
  });

  it("threads by In-Reply-To, then by subject within 14 days", async () => {
    const first = await ingest.ingestInboundEmail(
      ctxA,
      mailboxA,
      await payloadFor({ subject: "Consulta envío", from: { address: "bo@example.com", name: "Bo" } }),
    );
    const firstMessage = (await threads.listThreadMessages(ctxA, first.threadId))[0];

    const byHeader = await ingest.ingestInboundEmail(
      ctxA,
      mailboxA,
      await payloadFor({
        subject: "algo distinto",
        from: { address: "otro@example.com", name: null },
        inReplyTo: `<${firstMessage.messageId}>`,
      }),
    );
    expect(byHeader.threadId).toBe(first.threadId);

    const bySubject = await ingest.ingestInboundEmail(
      ctxA,
      mailboxA,
      await payloadFor({ subject: "RE: Consulta   envío", from: { address: "bo@example.com", name: "Bo" } }),
    );
    expect(bySubject.threadId).toBe(first.threadId);

    const later = new Date(Date.now() + 15 * 86_400_000);
    const stale = await ingest.ingestInboundEmail(
      ctxA,
      mailboxA,
      await payloadFor({ subject: "Consulta envío", from: { address: "bo@example.com", name: "Bo" }, date: later.toUTCString() }),
      later,
    );
    expect(stale.threadId).not.toBe(first.threadId);
  });

  it("links the sender to an existing contact by email, and never invents one", async () => {
    const { createContact } = await import("@/modules/crm/contacts");
    const contact = await createContact(ctxA, {
      name: "Carla",
      phone: `+5959810${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`,
      email: "carla@example.com",
    });

    const linked = await ingest.ingestInboundEmail(
      ctxA,
      mailboxA,
      await payloadFor({ subject: "Hola", from: { address: "carla@example.com", name: "Carla" } }),
    );
    expect(linked.status === "stored" && linked.contactId).toBe(contact!.id);
    expect((await threads.getThread(ctxA, linked.threadId))?.contactId).toBe(contact!.id);

    const unknown = await ingest.ingestInboundEmail(
      ctxA,
      mailboxA,
      await payloadFor({ subject: "Hola", from: { address: "nadie@example.com", name: null } }),
    );
    expect((await threads.getThread(ctxA, unknown.threadId))?.contactId).toBeNull();
  });

  it("isolates threads, messages and attachments between businesses", async () => {
    const stored = await ingest.ingestInboundEmail(ctxA, mailboxA, await payloadFor({ subject: "Privado" }));
    const [message] = await threads.listThreadMessages(ctxA, stored.threadId);
    const [attachment] = await threads.listAttachmentsForMessages(ctxA, [message.id]);

    expect(await threads.getThread(ctxB, stored.threadId)).toBeNull();
    expect(await threads.listThreadMessages(ctxB, stored.threadId)).toEqual([]);
    expect(await threads.getMessage(ctxB, message.id)).toBeNull();
    expect(await threads.getAttachment(ctxB, attachment.id)).toBeNull();
    expect(await threads.listAttachmentsForMessages(ctxB, [message.id])).toEqual([]);
    expect((await threads.listThreads(ctxB)).map((t) => t.id)).not.toContain(stored.threadId);
    expect(await mailboxes.getMailbox(ctxB, mailboxA.id)).toBeNull();

    await threads.markThreadRead(ctxB, stored.threadId);
    expect((await threads.getThread(ctxA, stored.threadId))?.unread).toBe(true);
    await expect(threads.linkThread(ctxB, stored.threadId, { contactId: "x".repeat(26) })).rejects.toThrow();
  });
});
