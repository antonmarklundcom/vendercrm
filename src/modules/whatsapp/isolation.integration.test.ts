import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Extends the tenant-isolation merge gate (PLAN.md §3.3) to the WhatsApp tables.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("cross-tenant isolation — WhatsApp", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let tenancy: typeof import("@/modules/tenancy/service");
  let wa: typeof import("./index");
  let processing: typeof import("./processing");
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let A: { ctx: TenantContext; phoneNumberId: string };
  let B: { ctx: TenantContext; phoneNumberId: string };
  const uniq = () => Math.random().toString(36).slice(2, 8);
  const ctxFor = (tenantId: string): TenantContext => ({
    tenantId,
    userId: "u",
    role: "admin",
    isSuperadmin: false,
    impersonatorUserId: null,
  });

  async function setup(label: string) {
    const s = uniq();
    const { tenantId } = await tenancy.createTenant({
      name: label,
      slug: `${label}-${s}`,
      adminEmail: `${label}-${s}@x.com`,
      adminPassword: "password123",
      adminName: label,
    });
    const ctx = ctxFor(tenantId);
    const phoneNumberId = `pn-${label}-${s}`;
    await wa.connectManual(ctx, {
      wabaId: `WABA-${s}`,
      phoneNumberId,
      accessToken: "tok",
    });
    // Seed one inbound message.
    await processing.processWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "W",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: label }, wa_id: `59598${s}` }],
                messages: [
                  {
                    from: `59598${s}`,
                    id: `wamid.${label}.${s}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: `hola ${label}` },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    return { ctx, phoneNumberId };
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    tenancy = await import("@/modules/tenancy/service");
    wa = await import("./index");
    processing = await import("./processing");
    A = await setup("waa");
    B = await setup("wab");
  });

  afterAll(async () => {
    if (!db) return;
    // Deliberately NOT closing the pool here: db/client.ts is a
    // module-level singleton, and depending on vitest's isolation/pool
    // settings it can be shared across test files run in the same
    // process — closing it here raced with other files still using it
    // (their queries would see a closed pool). The process exits when
    // the whole suite finishes, which reclaims the connection anyway.
  });

  it("conversations are scoped per tenant", async () => {
    const aConvs = await wa.listConversations(A.ctx);
    const bConvs = await wa.listConversations(B.ctx);
    expect(aConvs.length).toBe(1);
    expect(bConvs.length).toBe(1);
    expect(aConvs[0].id).not.toBe(bConvs[0].id);
    expect(aConvs.every((c) => c.tenantId === A.ctx.tenantId)).toBe(true);
  });

  it("A cannot read B's messages", async () => {
    const bConvs = await wa.listConversations(B.ctx);
    // Ask A's scoped view for B's conversation id → empty.
    const leaked = await wa.listMessages(A.ctx, bConvs[0].id);
    expect(leaked.length).toBe(0);
  });

  it("A cannot fetch B's WhatsApp account", async () => {
    const [bAccount] = await db
      .select()
      .from(schema.waAccounts)
      .where(eq(schema.waAccounts.tenantId, B.ctx.tenantId));
    expect(await wa.getAccountById(A.ctx, bAccount.id)).toBeNull();
  });
});
