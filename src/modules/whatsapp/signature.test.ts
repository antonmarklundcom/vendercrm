import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./signature";

const secret = "test-app-secret";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
const validSig =
  "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

describe("verifyWebhookSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyWebhookSignature(body, validSig, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(body + " ", validSig, secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature(body, validSig, "other-secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });

  it("rejects a malformed header without length leak", () => {
    expect(verifyWebhookSignature(body, "sha256=abc", secret)).toBe(false);
  });
});
