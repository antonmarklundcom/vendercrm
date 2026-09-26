import { describe, expect, it } from "vitest";
import { signInbound, verifyInboundSignature } from "./signature";
import { signInbound as workerSign } from "../../../workers/email-inbound/src/sign";

const secret = "s".repeat(40);
const body = JSON.stringify({ hello: "mundo" });
const now = 1_790_000_000;

describe("inbound signature", () => {
  it("accepts a fresh, correct signature", () => {
    const timestamp = String(now);
    const signature = signInbound(secret, timestamp, body);
    expect(verifyInboundSignature({ secret, timestamp, signature, body, nowSeconds: now + 10 })).toBe(true);
  });

  it("rejects a tampered body, a wrong secret and a missing header", () => {
    const timestamp = String(now);
    const signature = signInbound(secret, timestamp, body);
    const base = { secret, timestamp, signature, body, nowSeconds: now };
    expect(verifyInboundSignature({ ...base, body: body + " " })).toBe(false);
    expect(verifyInboundSignature({ ...base, secret: "other-secret" })).toBe(false);
    expect(verifyInboundSignature({ ...base, signature: null })).toBe(false);
    expect(verifyInboundSignature({ ...base, timestamp: null })).toBe(false);
    expect(verifyInboundSignature({ ...base, signature: "abc" })).toBe(false);
  });

  it("rejects a timestamp outside the five-minute window, either way", () => {
    const timestamp = String(now);
    const signature = signInbound(secret, timestamp, body);
    const base = { secret, timestamp, signature, body };
    expect(verifyInboundSignature({ ...base, nowSeconds: now + 301 })).toBe(false);
    expect(verifyInboundSignature({ ...base, nowSeconds: now - 301 })).toBe(false);
    expect(verifyInboundSignature({ ...base, nowSeconds: now + 299 })).toBe(true);
  });

  it("binds the timestamp into the signature", () => {
    const signature = signInbound(secret, String(now), body);
    expect(
      verifyInboundSignature({ secret, timestamp: String(now + 1), signature, body, nowSeconds: now }),
    ).toBe(false);
  });

  it("matches the Worker's WebCrypto implementation", async () => {
    const timestamp = String(now);
    expect(await workerSign(secret, timestamp, body)).toBe(signInbound(secret, timestamp, body));
  });
});
