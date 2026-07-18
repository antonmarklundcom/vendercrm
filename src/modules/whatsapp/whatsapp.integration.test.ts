import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Reliability core of 1D (PLAN.md §6.3/§6.4). DB-gated like the other
// integration suites.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("WhatsApp ingestion + sending", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let tenancy: typeof import("@/modules/tenancy/service");
  let wa: typeof import("./index");
  let processing: typeof import("./processing");
  let platform: typeof import("./platform");
  let graph: typeof import("./graph");
  let queue: typeof import("@/lib/queue");
  let worker: typeof import("@/worker");
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let ctx: TenantContext;
  let phoneNumberId: string;
  // Meta message ids are globally unique, and so is our wa_message_id index —
  // give each run its own id namespace so reruns on a persisted DB don't clash.
  let run: string;
  const uniq = () => Math.random().toString(36).slice(2, 8);
  const mid = (label: string) => `wamid.${label}.${run}`;

  function inboundPayload(waMessageId: string, from = "595981555123") {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: "Juan" }, wa_id: from }],
                messages: [
                  {
                    from,
                    id: waMessageId,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    tenancy = await import("@/modules/tenancy/service");
    wa = await import("./index");
    processing = await import("./processing");
    platform = await import("./platform");
    graph = await import("./graph");
    queue = await import("@/lib/queue");
    worker = await import("@/worker");
    await import("./jobs");

    const s = uniq();
    run = s;
    const { tenantId, adminUserId } = await tenancy.createTenant({
      name: "WA Co",
      slug: `wa-${s}`,
      adminEmail: `wa-${s}@x.com`,
      adminPassword: "password123",
      adminName: "Owner",
    });
    ctx = {
      tenantId,
      userId: adminUserId,
      role: "admin",
      isSuperadmin: false,
      impersonatorUserId: null,
    };
    phoneNumberId = `pn-${s}`;
    await wa.connectManual(ctx, {
      wabaId: "WABA1",
      phoneNumberId,
      accessToken: "secret-token",
      displayNumber: "+595 21 000",
    });
  });

  afterAll(async () => {
    graph.resetGraphFetch();
    if (!db) return;
    // Deliberately NOT closing the pool here: db/client.ts is a
    // module-level singleton, and depending on vitest's isolation/pool
    // settings it can be shared across test files run in the same
    // process — closing it here raced with other files still using it
    // (their queries would see a closed pool). The process exits when
    // the whole suite finishes, which reclaims the connection anyway.
  });

  it("stores an inbound message and opens a conversation", async () => {
    await processing.processWebhookPayload(inboundPayload(mid("IN1")));

    const contacts = await import("@/modules/crm/contacts").then((m) =>
      m.listContacts(ctx, { search: "Juan" }),
    );
    expect(contacts.length).toBe(1);
    expect(contacts[0].phone).toBe("+595981555123");

    const convs = await wa.listConversations(ctx);
    expect(convs.length).toBe(1);
    expect(convs[0].unreadCount).toBe(1);
    expect(convs[0].lastInboundAt).not.toBeNull();

    const msgs = await wa.listMessages(ctx, convs[0].id);
    expect(msgs.length).toBe(1);
    expect(msgs[0].direction).toBe("in");
    expect(msgs[0].body).toBe("Hola");
  });

  it("is idempotent — a redelivered webhook is a no-op", async () => {
    // Same message id delivered twice more.
    await processing.processWebhookPayload(inboundPayload(mid("IN1")));
    await processing.processWebhookPayload(inboundPayload(mid("IN1")));

    const convs = await wa.listConversations(ctx);
    const msgs = await wa.listMessages(ctx, convs[0].id);
    const inbound = msgs.filter((m) => m.waMessageId === mid("IN1"));
    expect(inbound.length).toBe(1); // still one row
    expect(convs[0].unreadCount).toBe(1); // side effects not repeated
  });

  it("rejects an unknown phone_number_id without crashing", async () => {
    const bad = inboundPayload(mid("X"));
    bad.entry[0].changes[0].value.metadata.phone_number_id = "does-not-exist";
    await expect(processing.processWebhookPayload(bad)).rejects.toBeInstanceOf(
      processing.UnknownAccountError,
    );
  });

  it("full durable path: persisted event → queued job → processed message", async () => {
    const eventId = await platform.recordWebhookEvent({
      phoneNumberId,
      payload: inboundPayload(mid("DURABLE")),
    });
    await queue.enqueue("whatsapp.process_webhook", { webhookEventId: eventId });

    // Drain the queue like the running worker would.
    // The jobs table is shared across the whole test run, so budget
    // generously enough to also clear other tests' interleaved jobs (e.g.
    // automation triggers now enqueued on every contact/message event).
    for (let i = 0; i < 200; i++) if (!(await worker.tick("test"))) break;

    const [event] = await db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, eventId));
    expect(event.status).toBe("processed");

    const stored = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.waMessageId, mid("DURABLE")));
    expect(stored.length).toBe(1);
  });

  it("enforces the 24h window and sends via a mocked Graph API", async () => {
    const convs = await wa.listConversations(ctx);
    const conv = convs[0];

    // Inside the window (we just received a message): free-form text allowed.
    graph.setGraphFetch(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: mid("OUT1") }] }), {
          status: 200,
        }),
    );
    const messageId = await wa.sendMessage(ctx, {
      conversationId: conv.id,
      kind: "text",
      body: "Respuesta",
    });

    // Deliver the queued send.
    // The jobs table is shared across the whole test run, so budget
    // generously enough to also clear other tests' interleaved jobs (e.g.
    // automation triggers now enqueued on every contact/message event).
    for (let i = 0; i < 200; i++) if (!(await worker.tick("test"))) break;

    const [sent] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId));
    expect(sent.status).toBe("sent");
    expect(sent.waMessageId).toBe(mid("OUT1"));

    // A delivered status update flips the message to delivered.
    await processing.processWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: phoneNumberId },
                statuses: [{ id: mid("OUT1"), status: "delivered" }],
              },
            },
          ],
        },
      ],
    });
    const [afterStatus] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId));
    expect(afterStatus.status).toBe("delivered");
  });

  it("blocks free-form text outside the 24h window", async () => {
    // Force the conversation's last inbound far into the past.
    const convs = await wa.listConversations(ctx);
    const conv = convs[0];
    await db
      .update(schema.conversations)
      .set({ lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(schema.conversations.id, conv.id));

    await expect(
      wa.sendMessage(ctx, {
        conversationId: conv.id,
        kind: "text",
        body: "tarde",
      }),
    ).rejects.toBeInstanceOf(wa.WindowClosedError);
  });
});
