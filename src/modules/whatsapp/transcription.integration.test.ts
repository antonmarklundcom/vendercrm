import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// W1 — voice notes (PLAN.md §15.3 Lane A, §15.10). Everything here is the
// real path: a real stored object, the real driver seam with only `fetch`
// stubbed, and real rows. The provider is the one thing a test cannot have.
const hasDb = !!process.env.DATABASE_URL;

const originalFetch = globalThis.fetch;

/** Answers the transcription endpoint with `text`, or fails with `status`. */
function stubProvider(text: string | null, status = 200) {
  globalThis.fetch = (async () =>
    text === null
      ? new Response("provider exploded", { status })
      : new Response(JSON.stringify({ text }), { status: 200 })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("voice-note transcription (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let newId: (typeof import("@/lib/ids"))["newId"];
  let transcription: typeof import("./transcription");
  let inbox: typeof import("./inbox");
  let ctx: TenantContext;
  let accountId: string;
  let contactId: string;
  let ownerContactId: string;
  let conversationId: string;
  let ownerConversationId: string;

  const OWNER_PHONE = "+595981777111";

  /** A stored audio message, as the webhook would have written it. */
  async function audioMessage(
    conversation: string,
    bytes: Buffer,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const { storage } = await import("@/lib/storage");

    const id = newId();
    const key = `whatsapp-media/${ctx.tenantId}/${id}`;
    await storage.put(key, bytes, "audio/ogg");
    await db.insert(schema.messages).values({
      id,
      tenantId: ctx.tenantId,
      conversationId: conversation,
      direction: "in",
      type: "audio",
      storageKey: key,
      mediaMimeType: "audio/ogg; codecs=opus",
      transcriptStatus: "pending",
      status: "delivered",
      ...overrides,
    });
    return id;
  }

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    transcription = await import("./transcription");
    inbox = await import("./inbox");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { connectAccountManually } = await import("./accounts");
    const { createContact } = await import("@/modules/crm/contacts");

    const tenant = await createTenant(
      { userId: "sa-w1", impersonatorUserId: null },
      { name: `W1 ${newId()}`, slug: `w1-${newId()}` },
    );

    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };

    const account = await connectAccountManually(ctx, {
      wabaId: `waba-${newId()}`,
      phoneNumberId: `pn-${newId()}`,
      accessToken: "token",
    });
    accountId = account.id;

    contactId = (await createContact(ctx, { name: "Cliente", phone: "+595981777222" }))!.id;
    ownerContactId = (await createContact(ctx, { name: "Dueño", phone: OWNER_PHONE }))!.id;
    conversationId = (await inbox.getOrCreateConversation(ctx, accountId, contactId)).id;
    ownerConversationId = (await inbox.getOrCreateConversation(ctx, accountId, ownerContactId)).id;
  });

  it("transcribes a stored voice note and meters it on the ai_replies ledger", async () => {
    const messageId = await audioMessage(conversationId, Buffer.from("opus"));
    stubProvider("Hola, quiero un presupuesto para el portón.");

    const outcome = await transcription.transcribeMessage(ctx, messageId);
    expect(outcome).toMatchObject({ status: "done" });

    const rows = await inbox.listMessagesForConversation(ctx, conversationId);
    const row = rows.find((m) => m.id === messageId)!;
    expect(row.transcriptStatus).toBe("done");
    expect(row.transcript).toContain("portón");
    expect(row.transcriptAt).not.toBeNull();

    const { aiReplies } = await import("@/db/schema");
    const { tenantDb } = await import("@/modules/tenancy/db");
    const { eq } = await import("drizzle-orm");
    const ledger = await tenantDb(ctx).select(aiReplies, eq(aiReplies.messageId, messageId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("transcription");
  });

  it("is idempotent — a second run does not call the provider again", async () => {
    const messageId = await audioMessage(conversationId, Buffer.from("opus"));
    stubProvider("una sola vez");
    await transcription.transcribeMessage(ctx, messageId);

    // Any call now would throw rather than answer.
    globalThis.fetch = (async () => {
      throw new Error("the provider was called twice");
    }) as unknown as typeof fetch;

    const outcome = await transcription.transcribeMessage(ctx, messageId);
    expect(outcome).toEqual({ status: "done", text: "una sola vez" });
  });

  it("records the reason and rethrows when the provider fails, so the queue retries", async () => {
    const messageId = await audioMessage(conversationId, Buffer.from("opus"));
    stubProvider(null, 503);

    await expect(transcription.transcribeMessage(ctx, messageId)).rejects.toThrow(/503/);

    const rows = await inbox.listMessagesForConversation(ctx, conversationId);
    const row = rows.find((m) => m.id === messageId)!;
    expect(row.transcriptStatus).toBe("failed");
    expect(row.transcriptError).toMatch(/503/);
  });

  it("skips an audio larger than the cap without calling the provider", async () => {
    const messageId = await audioMessage(
      conversationId,
      Buffer.alloc(transcription.MAX_AUDIO_BYTES + 1),
    );
    globalThis.fetch = (async () => {
      throw new Error("an oversized audio must never reach the provider");
    }) as unknown as typeof fetch;

    const outcome = await transcription.transcribeMessage(ctx, messageId);
    expect(outcome).toEqual({ status: "skipped", reason: "too_large" });

    const rows = await inbox.listMessagesForConversation(ctx, conversationId);
    expect(rows.find((m) => m.id === messageId)!.transcriptStatus).toBe("skipped");
  });

  it("skips once the tenant's daily AI budget is spent", async () => {
    const { updateTenantAiSettings } = await import("@/modules/tenancy/settings");
    await updateTenantAiSettings(ctx, { maxRepliesPerTenantPerDay: 1 });

    const messageId = await audioMessage(conversationId, Buffer.from("opus"));
    globalThis.fetch = (async () => {
      throw new Error("a capped tenant must never reach the provider");
    }) as unknown as typeof fetch;

    const outcome = await transcription.transcribeMessage(ctx, messageId);
    expect(outcome).toEqual({ status: "skipped", reason: "tenant_daily_cap" });

    await updateTenantAiSettings(ctx, { maxRepliesPerTenantPerDay: 200 });
  });

  it("finds a conversation by what was said in a voice note", async () => {
    const messageId = await audioMessage(conversationId, Buffer.from("opus"));
    stubProvider("necesito una visita técnica el martes");
    await transcription.transcribeMessage(ctx, messageId);

    const found = await inbox.searchConversations(ctx, "visita técnica");
    expect(found.map((c) => c.id)).toContain(conversationId);
  });

  it("defers the automation chain until the words exist, then runs it once with them", async () => {
    const { registerAutomationTriggers } = await import("@/modules/automations/triggers");
    const { whatsappEvents } = await import("./events");
    const { db } = await import("@/db/client");
    const { jobs } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    registerAutomationTriggers();

    const messageId = await audioMessage(conversationId, Buffer.from("opus"));

    const triggerJobs = async () => {
      const rows = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.type, "automation.trigger"), eq(jobs.tenantId, ctx.tenantId)));
      return rows.filter(
        (row) => (row.payload as { data?: { messageId?: string } }).data?.messageId === messageId,
      );
    };

    // Arrival: the inbox learns immediately, the flows deliberately do not.
    await whatsappEvents.emit("wa.message_received", {
      tenantId: ctx.tenantId,
      conversationId,
      contactId,
      messageId,
      transcriptPending: true,
    });
    expect(await triggerJobs()).toHaveLength(0);

    stubProvider("necesito que me llamen, es urgente");
    await transcription.transcribeMessage(ctx, messageId);
    await whatsappEvents.emit("wa.message_transcribed", {
      tenantId: ctx.tenantId,
      conversationId,
      contactId,
      messageId,
    });

    const fired = await triggerJobs();
    expect(fired).toHaveLength(1);
    // With the words in it — a keyword-narrowed flow could not match otherwise.
    expect((fired[0].payload as { data: { body: string } }).data.body).toContain("urgente");
  });

  it("answers the owner's own voice note with the Hoy list, and ignores everyone else's", async () => {
    const { updateTenantCoachPhone } = await import("@/modules/tenancy/settings");
    const { maybeAnswerCoachVoiceNote } = await import("@/modules/coach/voice");
    await updateTenantCoachPhone(ctx, OWNER_PHONE);

    // The window has to be open for a free-form answer — the owner just
    // "spoke", which is exactly what an inbound message means.
    const { conversations } = await import("@/db/schema");
    const { tenantDb } = await import("@/modules/tenancy/db");
    const { eq } = await import("drizzle-orm");
    await tenantDb(ctx)
      .update(conversations)
      .set({ lastInboundAt: new Date() })
      .where(eq(conversations.id, ownerConversationId));

    const ownerMessage = await audioMessage(ownerConversationId, Buffer.from("opus"));
    stubProvider("hola, qué tengo hoy?");
    await transcription.transcribeMessage(ctx, ownerMessage);

    const answered = await maybeAnswerCoachVoiceNote(ctx, {
      messageId: ownerMessage,
      conversationId: ownerConversationId,
      contactId: ownerContactId,
    });
    expect(answered.status).toBe("answered");

    const ownerThread = await inbox.listMessagesForConversation(ctx, ownerConversationId);
    expect(ownerThread.some((m) => m.direction === "out")).toBe(true);

    // Same words from a customer are just a customer message.
    const customerMessage = await audioMessage(conversationId, Buffer.from("opus"));
    stubProvider("qué tengo hoy?");
    await transcription.transcribeMessage(ctx, customerMessage);

    const ignored = await maybeAnswerCoachVoiceNote(ctx, {
      messageId: customerMessage,
      conversationId,
      contactId,
    });
    expect(ignored).toEqual({ status: "ignored", reason: "not_owner" });
  });
});
