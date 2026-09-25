import { beforeEach, describe, expect, it, vi } from "vitest";

// The webhook's decision table with the platform configured — everything
// behind the signature check is mocked; the MySQL half lives in
// mailbox.integration.test.ts.

const SECRET = "inbound-secret-for-tests-0123456789";

vi.mock("@/lib/config/env", () => ({
  env: {
    STORAGE_DRIVER: "s3",
    CLOUDFLARE_ACCOUNT_ID: "acc",
    CLOUDFLARE_EMAIL_API_TOKEN: "tok",
    EMAIL_INBOUND_SECRET: "inbound-secret-for-tests-0123456789",
  },
}));

const resolveRecipient = vi.fn();
const ingestInboundEmail = vi.fn();
const buildSystemTenantContext = vi.fn();

vi.mock("./mailboxes", () => ({ resolveRecipient: (...a: unknown[]) => resolveRecipient(...a) }));
vi.mock("./ingest", () => ({ ingestInboundEmail: (...a: unknown[]) => ingestInboundEmail(...a) }));
vi.mock("@/modules/tenancy/context", () => ({
  buildSystemTenantContext: (...a: unknown[]) => buildSystemTenantContext(...a),
}));

const { handleInboundEmail } = await import("./inbound");
const { signInbound } = await import("./signature");

const payload = {
  version: 1,
  envelopeTo: "contacto@tienda.com.py",
  messageId: "<m1@example.com>",
  subject: "Hola",
  from: { address: "ana@example.com", name: "Ana" },
  rawKey: "email-inbound/2026-09-25/u1/raw.eml",
  rawSize: 10,
};

function signed(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return new Headers({
    "x-vendercrm-timestamp": String(timestamp),
    "x-vendercrm-signature": signInbound(SECRET, String(timestamp), body),
  });
}

beforeEach(() => {
  resolveRecipient.mockReset();
  ingestInboundEmail.mockReset();
  buildSystemTenantContext.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("handleInboundEmail", () => {
  it("rejects an unsigned or stale request without touching anything", async () => {
    const body = JSON.stringify(payload);
    expect((await handleInboundEmail(body, new Headers())).status).toBe(401);
    const old = Math.floor(Date.now() / 1000) - 600;
    expect((await handleInboundEmail(body, signed(body, old))).status).toBe(401);
    expect(resolveRecipient).not.toHaveBeenCalled();
  });

  it("answers 400 to a malformed payload and to a key outside email-inbound/", async () => {
    const bad = JSON.stringify({ ...payload, version: 2 });
    expect((await handleInboundEmail(bad, signed(bad))).status).toBe(400);
    const escape = JSON.stringify({ ...payload, rawKey: "documents/t1/secret.pdf" });
    expect((await handleInboundEmail(escape, signed(escape))).status).toBe(400);
  });

  it("discards mail for an unknown recipient with 202", async () => {
    resolveRecipient.mockResolvedValue(null);
    const body = JSON.stringify(payload);
    const result = await handleInboundEmail(body, signed(body));
    expect(result).toEqual({ status: 202, body: { status: "discarded" } });
  });

  it("asks for a retry while the business is read-only", async () => {
    resolveRecipient.mockResolvedValue({ tenantId: "t1", mailbox: { id: "mb1" } });
    buildSystemTenantContext.mockResolvedValue({ tenantId: "t1", accessStatus: "locked" });
    const body = JSON.stringify(payload);
    expect((await handleInboundEmail(body, signed(body))).status).toBe(503);
    expect(ingestInboundEmail).not.toHaveBeenCalled();
  });

  it("stores through ingest and reports duplicates as 200", async () => {
    resolveRecipient.mockResolvedValue({ tenantId: "t1", mailbox: { id: "mb1" } });
    buildSystemTenantContext.mockResolvedValue({ tenantId: "t1", accessStatus: "active" });
    ingestInboundEmail.mockResolvedValueOnce({ status: "stored" }).mockResolvedValueOnce({ status: "duplicate" });
    const body = JSON.stringify(payload);
    expect(await handleInboundEmail(body, signed(body))).toEqual({ status: 200, body: { status: "stored" } });
    expect(await handleInboundEmail(body, signed(body))).toEqual({ status: 200, body: { status: "duplicate" } });
  });
});
