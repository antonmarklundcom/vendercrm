import { describe, expect, it } from "vitest";
import {
  buildPayload,
  classifyResponse,
  flattenAddresses,
  nextAttemptDelayMs,
} from "../../../workers/email-inbound/src/payload";
import { inboundPayloadSchema } from "./payload";

// The Worker's pure half, checked against the app's own payload schema so
// the two cannot drift apart silently.

describe("email-inbound Worker payload", () => {
  const base = {
    envelopeTo: "Contacto@Tienda.com.py",
    envelopeFrom: "bounce@mail.example.com",
    rawKey: "email-inbound/2026-09-25/u1/raw.eml",
    rawSize: 1234,
    fallbackMessageId: "hash@vendercrm.generated",
    attachments: [
      { key: "email-inbound/2026-09-25/u1/att-0", filename: "a.pdf", mimeType: "application/pdf", size: 10 },
    ],
  };

  it("builds a payload the app accepts", () => {
    const payload = buildPayload({
      ...base,
      parsed: {
        from: { name: "Ana", address: "Ana@Example.com" },
        to: [{ name: "", address: "contacto@tienda.com.py" }],
        cc: [{ name: "Equipo", group: [{ name: "Bo", address: "bo@example.com" }] }],
        subject: "Presupuesto",
        messageId: "<m1@example.com>",
        inReplyTo: "<m0@tienda.com.py>",
        references: "<a@x> <m0@tienda.com.py>",
        date: "Thu, 25 Sep 2026 10:00:00 -0300",
        text: "Hola",
        html: "<p>Hola</p>",
      },
    });
    expect(payload.envelopeTo).toBe("contacto@tienda.com.py");
    expect(payload.from).toEqual({ address: "ana@example.com", name: "Ana" });
    expect(payload.cc).toEqual([{ address: "bo@example.com", name: "Bo" }]);
    expect(payload.references).toEqual(["<a@x>", "<m0@tienda.com.py>"]);
    expect(inboundPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("falls back to a generated Message-ID and the envelope sender", () => {
    const payload = buildPayload({ ...base, parsed: {} });
    expect(payload.messageId).toBe("hash@vendercrm.generated");
    expect(payload.from.address).toBe("bounce@mail.example.com");
    expect(inboundPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("drops malformed addresses", () => {
    expect(flattenAddresses([{ name: "x", address: "not-an-address" }])).toEqual([]);
  });
});

describe("delivery policy", () => {
  it("retries configuration and server problems, gives up on bad payloads", () => {
    expect(classifyResponse(200)).toBe("done");
    expect(classifyResponse(202)).toBe("discarded");
    expect(classifyResponse(400)).toBe("failed");
    expect(classifyResponse(401)).toBe("retry");
    expect(classifyResponse(404)).toBe("retry");
    expect(classifyResponse(503)).toBe("retry");
    expect(classifyResponse(0)).toBe("retry");
  });

  it("backs off from 5 minutes up to 6 hours", () => {
    expect(nextAttemptDelayMs(1)).toBe(5 * 60_000);
    expect(nextAttemptDelayMs(2)).toBe(10 * 60_000);
    expect(nextAttemptDelayMs(20)).toBe(6 * 3600_000);
  });
});
