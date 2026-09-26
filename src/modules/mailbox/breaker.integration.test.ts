import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Sending limits and the bounce / complaint circuit breaker (PLAN-EMAIL.md
// E5) against MySQL, with the platform switch forced on and a fake provider.

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

describe.skipIf(!hasDb)("mailbox limits and breaker (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let reply: typeof import("./reply");
  let breaker: typeof import("./breaker");
  let guard: typeof import("./guard");
  let threads: typeof import("./threads");
  let getTenant: (typeof import("@/modules/tenancy/tenants"))["getTenant"];
  let newId: (typeof import("@/lib/ids"))["newId"];

  const okProvider = { name: "cloudflare" as const, send: vi.fn(async () => ({ ok: true as const })) };
  const bounceProvider = {
    name: "cloudflare" as const,
    send: vi.fn(async () => ({ ok: false as const, bounced: true })),
  };

  async function businessWithThread(label: string) {
    const { storage } = await import("@/lib/storage");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");
    const { createMailbox } = await import("./mailboxes");
    const { ingestInboundEmail } = await import("./ingest");
    const tenant = await createTenant(
      { userId: "sa-e5", impersonatorUserId: null },
      { name: label, slug: `e5-${newId()}`.toLowerCase() },
    );
    const ctx: TenantContext = { ...(await buildSystemTenantContext(tenant!.id))!, accessStatus: "active" };
    const domain = `e5-${newId().slice(-8).toLowerCase()}.com`;
    const mailbox = await createMailbox(ctx, { address: `hola@${domain}` });
    const base = `email-inbound/test/${newId()}`;
    await storage.put(`${base}/raw.eml`, Buffer.from("x"));
    const stored = await ingestInboundEmail(ctx, mailbox!, {
      version: 1,
      envelopeTo: mailbox!.address,
      envelopeFrom: null,
      messageId: `<${newId()}@example.com>`,
      inReplyTo: null,
      references: [],
      subject: "Hola",
      date: null,
      from: { address: "cliente@example.com", name: null },
      to: [],
      cc: [],
      replyTo: [],
      text: "Hola",
      html: null,
      rawKey: `${base}/raw.eml`,
      rawSize: 1,
      attachments: [],
    });
    return { ctx, threadId: stored.threadId, mailbox: mailbox! };
  }

  beforeAll(async () => {
    reply = await import("./reply");
    breaker = await import("./breaker");
    guard = await import("./guard");
    threads = await import("./threads");
    ({ getTenant } = await import("@/modules/tenancy/tenants"));
    ({ newId } = await import("@/lib/ids"));
  });

  it("stops at the warm-up cap for a new business", async () => {
    const { ctx, threadId } = await businessWithThread("E5 cap");
    for (let i = 0; i < guard.WARMUP_DAILY_CAP; i++) {
      const result = await reply.sendThreadReply(
        ctx,
        { threadId, body: `mensaje ${i}` },
        { provider: okProvider, guard: guard.mailboxReplyGuard },
      );
      expect(result.ok).toBe(true);
    }
    expect(
      await reply.sendThreadReply(ctx, { threadId, body: "uno más" }, { provider: okProvider, guard: guard.mailboxReplyGuard }),
    ).toEqual({ ok: false, error: "daily_limit" });
    expect((await guard.mailboxSendStats(ctx)).sentLast24h).toBe(guard.WARMUP_DAILY_CAP);
  });

  it("suspends a business after a second synchronous bounce, and only that business", async () => {
    const a = await businessWithThread("E5 bounce");
    const b = await businessWithThread("E5 bystander");
    expect((await reply.sendThreadReply(a.ctx, { threadId: a.threadId, body: "1" }, { provider: bounceProvider })).ok).toBe(false);
    expect((await getTenant(a.ctx.tenantId))?.outboundSuspendedAt).toBeNull();
    await reply.sendThreadReply(a.ctx, { threadId: a.threadId, body: "2" }, { provider: bounceProvider });

    expect((await getTenant(a.ctx.tenantId))?.outboundSuspendedAt).not.toBeNull();
    expect((await getTenant(b.ctx.tenantId))?.outboundSuspendedAt).toBeNull();
    const statuses = (await threads.listThreadMessages(a.ctx, a.threadId)).map((m) => m.status);
    expect(statuses.filter((s) => s === "bounced")).toHaveLength(2);
    expect(
      await reply.sendThreadReply(a.ctx, { threadId: a.threadId, body: "3" }, { provider: okProvider }),
    ).toEqual({ ok: false, error: "suspended" });

    const { listAuditLogForTenant } = await import("@/modules/tenancy/audit");
    const actions = (await listAuditLogForTenant(a.ctx.tenantId)).map((e) => e.action);
    expect(actions.filter((x) => x === "mailbox.outbound_suspended")).toHaveLength(1);
  });

  it("matches Cloudflare events to the send by address and trips on complaints", async () => {
    const { ctx, threadId, mailbox } = await businessWithThread("E5 events");
    await reply.sendThreadReply(ctx, { threadId, body: "a", cc: ["otro@example.com"] }, { provider: okProvider });

    expect(
      await breaker.recordDeliveryEvent({ type: "bounced", sender: "nadie@nowhere.test", recipient: "x@example.com" }),
    ).toBe("unmatched");
    expect(
      await breaker.recordDeliveryEvent({ type: "complained", sender: mailbox.address, recipient: "OTRO@example.com" }),
    ).toBe("matched");
    expect((await getTenant(ctx.tenantId))?.outboundSuspendedAt).toBeNull();

    await reply.sendThreadReply(ctx, { threadId, body: "b" }, { provider: okProvider });
    expect(
      await breaker.recordDeliveryEvent({ type: "complained", sender: mailbox.address, recipient: "cliente@example.com" }),
    ).toBe("matched");
    expect((await getTenant(ctx.tenantId))?.outboundSuspendedAt).not.toBeNull();

    const { clearOutboundSuspension } = await import("@/modules/tenancy/mailbox");
    await clearOutboundSuspension({ userId: "sa-e5", impersonatorUserId: null }, ctx.tenantId);
    expect((await getTenant(ctx.tenantId))?.outboundSuspendedAt).toBeNull();

    // Old complaints don't count after the operator cleared it: one new
    // complaint alone must not re-suspend. (MySQL datetimes are whole
    // seconds, so step past the clear's second first.)
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await reply.sendThreadReply(ctx, { threadId, body: "c" }, { provider: okProvider });
    await breaker.recordDeliveryEvent({ type: "complained", sender: mailbox.address, recipient: "cliente@example.com" });
    expect((await getTenant(ctx.tenantId))?.outboundSuspendedAt).toBeNull();
  });
});
