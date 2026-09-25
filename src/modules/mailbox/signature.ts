import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC for the inbound webhook (PLAN-EMAIL.md E2). The Worker signs
// `${timestamp}.${rawBody}` with EMAIL_INBOUND_SECRET (HMAC-SHA256, hex) and
// sends both in headers; the app recomputes and compares in constant time.
// The timestamp is bound into the signature and must be within five minutes
// of the app's clock, so a captured request cannot be replayed later.
//
// Pure (no env), so the Worker's WebCrypto implementation can be tested
// against this one (workers/email-inbound/src/sign.test.ts).

export const TIMESTAMP_HEADER = "x-vendercrm-timestamp";
export const SIGNATURE_HEADER = "x-vendercrm-signature";
export const MAX_SKEW_SECONDS = 5 * 60;

export function signInbound(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export type VerifyInput = {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
};

export function verifyInboundSignature(input: VerifyInput): boolean {
  const { secret, timestamp, signature, body } = input;
  if (!timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_SECONDS) return false;

  const expected = Buffer.from(signInbound(secret, timestamp, body), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
