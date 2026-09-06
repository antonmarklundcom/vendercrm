import { describe, expect, it } from "vitest";
import { buildUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

// Stateless unsubscribe token (PLAN.md §15.1, §15.8 P4): signed, not just
// encoded, so a token cannot be edited to target someone else's contact.

describe("unsubscribe token", () => {
  it("round-trips tenant id and contact id", () => {
    const token = buildUnsubscribeToken("tenant-1", "contact-1");
    expect(verifyUnsubscribeToken(token)).toEqual({ tenantId: "tenant-1", contactId: "contact-1" });
  });

  it("rejects a tampered contact id", () => {
    const token = buildUnsubscribeToken("tenant-1", "contact-1");
    const [, signature] = token.split(".");
    const forged = `${Buffer.from("tenant-1:contact-2", "utf8").toString("base64url")}.${signature}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
  });
});
