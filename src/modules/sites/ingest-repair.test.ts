import { describe, expect, it, vi } from "vitest";

// The ingest guard's accept-and-repair rules (PLAN.md §19.3), pure: no
// database. The end-to-end half (stored row, contact, 422s) is in
// ingest.test.ts, which needs MySQL.
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/config/env", () => ({ env: {} }));

const { INGEST_LIMITS, isCredentialKey, leadIngestSchema, repairLeadBody } = await import("./ingest");

// The body tasacion.com.py posts (PLAN.md §19).
const TASACION = {
  name: "María Benítez",
  phone: "0981 123 456",
  email: "maria@example.com",
  message: "Quiero tasar mi casa",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "tasacion-asuncion",
  page_url: "https://tasacion.com.py/tasar-casa",
  idempotency_key: "tasacion-0001",
  fields: { finalidad: "Venta", ciudad: "Lambaré" },
};

function repair(body: Record<string, unknown>) {
  const parsed = leadIngestSchema.safeParse(body);
  if (!parsed.success) throw new Error(parsed.error.message);
  return repairLeadBody(parsed.data);
}

const sortedKeys = (record: object) => Object.keys(record).sort();

describe("repairLeadBody", () => {
  it("keeps the exact tasacion payload as is, with nothing to review", () => {
    const lead = repair(TASACION);
    expect(lead.needsReview).toBeNull();
    expect(lead.name).toBe(TASACION.name);
    expect(lead.email).toBe(TASACION.email);
    expect(lead.invalidEmail).toBeUndefined();
    expect(lead.message).toBe(TASACION.message);
    expect(lead.utm).toMatchObject({ source: "google", medium: "cpc", campaign: "tasacion-asuncion" });
    expect(lead.pageUrl).toBe(TASACION.page_url);
    expect(lead.payload).toEqual(TASACION.fields);
  });

  it("folds an unknown top-level key into fields; an explicit fields entry wins a clash", () => {
    const lead = repair({ ...TASACION, prueba_extra: "sí", ciudad: "Asunción", superficie: 180 });
    expect(sortedKeys(lead.payload)).toEqual(["ciudad", "finalidad", "prueba_extra", "superficie"]);
    expect(lead.payload.prueba_extra).toBe("sí");
    expect(lead.payload.superficie).toBe(180);
    expect(lead.payload.ciudad).toBe("Lambaré");
    expect(lead.needsReview).toBeNull();
  });

  it("never stores credential-shaped keys or the Turnstile token, top level or in fields", () => {
    const lead = repair({
      ...TASACION,
      api_key: "vc_live_should_not_be_stored",
      client_secret: "s3cr3t",
      password: "hunter2",
      "X-Api-Key": "vc_live_header_copy",
      access_token: "tok",
      turnstile_token: "turnstile-value",
      "cf-turnstile-response": "turnstile-copy",
      fields: { ...TASACION.fields, token: "inner-token", apiKey: "inner-key" },
    });
    expect(sortedKeys(lead.payload)).toEqual(["ciudad", "finalidad"]);
    const stored = JSON.stringify(lead.payload);
    for (const secret of ["vc_live", "s3cr3t", "hunter2", "turnstile", "inner-token", "inner-key"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("accepts a 6,000-char message: truncated, flagged, original kept", () => {
    const message = "a".repeat(6000);
    const lead = repair({ ...TASACION, message });
    expect(lead.message!.length).toBe(5000);
    expect(lead.message!.endsWith("…[truncado]")).toBe(true);
    expect(lead.needsReview).toEqual(["message_truncated"]);
    expect((lead.payload._original as Record<string, string>).message).toBe(message);
    expect(lead.payload._original_cut).toBeUndefined();
  });

  it("keeps 20,000 characters of a 30,000-char original and says it was cut", () => {
    const lead = repair({ ...TASACION, message: "b".repeat(30_000) });
    expect((lead.payload._original as Record<string, string>).message).toHaveLength(20_000);
    expect(lead.payload._original_cut).toEqual(["message"]);
  });

  it("accepts juan@gmail: no contact e-mail, the raw value kept, email_invalid flagged", () => {
    const lead = repair({ ...TASACION, email: "juan@gmail" });
    expect(lead.email).toBeUndefined();
    expect(lead.invalidEmail).toBe("juan@gmail");
    expect(lead.needsReview).toEqual(["email_invalid"]);
  });

  it("treats an empty or null e-mail as absent rather than invalid", () => {
    expect(repair({ ...TASACION, email: "" })).toMatchObject({ email: undefined, needsReview: null });
    expect(repair({ ...TASACION, email: null })).toMatchObject({ email: undefined, needsReview: null });
  });

  it("truncates an over-long UTM and page URL to their columns", () => {
    const lead = repair({
      ...TASACION,
      utm_campaign: "c".repeat(300),
      page_url: `https://tasacion.com.py/?q=${"x".repeat(2500)}`,
    });
    expect(lead.utm.campaign).toHaveLength(200);
    expect(lead.pageUrl).toHaveLength(2000);
    expect(lead.needsReview!.sort()).toEqual(["page_url_truncated", "utm_truncated"]);
    expect(sortedKeys(lead.payload._original as object)).toEqual(["page_url", "utm_campaign"]);
  });

  it("caps fields at 100 keys and keeps the rest as originals", () => {
    const fields = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`campo_${i}`, `v${i}`]));
    const lead = repair({ ...TASACION, fields });
    const kept = Object.keys(lead.payload).filter((key) => key.startsWith("campo_"));
    expect(kept).toHaveLength(INGEST_LIMITS.fieldKeys);
    expect(lead.needsReview).toEqual(["fields_over_limit"]);
    expect(Object.keys(lead.payload._original as object)).toHaveLength(20);
  });

  it("truncates an over-long field value and flags that field", () => {
    const long = "z".repeat(INGEST_LIMITS.fieldValueLength + 1);
    const lead = repair({ ...TASACION, fields: { ...TASACION.fields, detalle: long } });
    expect((lead.payload.detalle as string).length).toBe(INGEST_LIMITS.fieldValueLength);
    expect(lead.needsReview).toEqual(["field_truncated:detalle"]);
    expect((lead.payload._original as Record<string, string>).detalle).toBe(long);
  });

  it("keeps the whole _original under its 64 KB cap", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`largo_${i}`, "q".repeat(15_000)]),
    );
    const lead = repair({ ...TASACION, fields });
    expect(Buffer.byteLength(JSON.stringify(lead.payload._original))).toBeLessThanOrEqual(
      INGEST_LIMITS.originalBytes,
    );
    expect((lead.payload._original_cut as string[]).length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(lead.payload))).toBeLessThan(INGEST_LIMITS.bodyBytes);
  });

  it("a __proto__ key cannot replace the payload's prototype", () => {
    const body = JSON.parse(
      `{"phone":"0981123456","idempotency_key":"proto-0001","fields":{"__proto__":{"polluted":1}}}`,
    );
    const lead = repair(body);
    expect(Object.getPrototypeOf(lead.payload)).toBe(Object.prototype);
    expect((lead.payload as { polluted?: unknown }).polluted).toBeUndefined();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

describe("leadIngestSchema", () => {
  it("still rejects a missing phone and a short idempotency key", () => {
    expect(leadIngestSchema.safeParse({ ...TASACION, phone: undefined }).success).toBe(false);
    expect(leadIngestSchema.safeParse({ ...TASACION, phone: "1".repeat(31) }).success).toBe(false);
    expect(leadIngestSchema.safeParse({ ...TASACION, idempotency_key: "short" }).success).toBe(false);
  });
});

describe("isCredentialKey", () => {
  it.each(["api_key", "apikey", "APIKEY", "x-api-key", "key", "token", "access_token", "password", "client_secret", "secret", "turnstile_token", "cf-turnstile-response", "privateKey"])(
    "%s is credential-shaped",
    (key) => expect(isCredentialKey(key)).toBe(true),
  );

  it.each(["finalidad", "ciudad", "keywords", "monkey", "secretaria", "tokens_usados", "passenger"])(
    "%s is customer data",
    (key) => expect(isCredentialKey(key)).toBe(false),
  );
});
