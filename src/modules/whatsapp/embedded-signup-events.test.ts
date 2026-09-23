import { describe, expect, it } from "vitest";
import { isFacebookOrigin, parseEmbeddedSignupMessage } from "./embedded-signup-events";

// The browser trusts these postMessage payloads only from Meta's origins, and
// has to tell a finished signup apart from a closed popup and a failure.

describe("isFacebookOrigin", () => {
  it("accepts facebook.com and its subdomains over https", () => {
    expect(isFacebookOrigin("https://www.facebook.com")).toBe(true);
    expect(isFacebookOrigin("https://web.facebook.com")).toBe(true);
    expect(isFacebookOrigin("https://facebook.com")).toBe(true);
  });

  it("rejects look-alikes, http and garbage", () => {
    expect(isFacebookOrigin("https://evilfacebook.com")).toBe(false);
    expect(isFacebookOrigin("https://facebook.com.evil.example")).toBe(false);
    expect(isFacebookOrigin("http://www.facebook.com")).toBe(false);
    expect(isFacebookOrigin("null")).toBe(false);
  });
});

describe("parseEmbeddedSignupMessage", () => {
  it("reads a Cloud API finish, from a string or an object", () => {
    const payload = {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      version: 3,
      data: { phone_number_id: "777", waba_id: "555", business_id: "1" },
    };
    const expected = { kind: "finish", wabaId: "555", phoneNumberId: "777", coexistence: false };
    expect(parseEmbeddedSignupMessage(payload)).toEqual(expected);
    expect(parseEmbeddedSignupMessage(JSON.stringify(payload))).toEqual(expected);
  });

  it("reads a coexistence finish that only carries the WABA id", () => {
    expect(
      parseEmbeddedSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
        version: 3,
        data: { waba_id: "555" },
      }),
    ).toEqual({ kind: "finish", wabaId: "555", phoneNumberId: undefined, coexistence: true });
  });

  it("tells a closed popup from a failure", () => {
    expect(
      parseEmbeddedSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "CANCEL",
        data: { current_step: "PHONE_NUMBER_SETUP" },
      }),
    ).toEqual({ kind: "cancel", step: "PHONE_NUMBER_SETUP" });
    expect(
      parseEmbeddedSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "CANCEL",
        data: { error_message: "Something broke", error_id: "1" },
      }),
    ).toEqual({ kind: "error", message: "Something broke" });
  });

  it("flags finishes without a usable number", () => {
    expect(
      parseEmbeddedSignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_ONLY_WABA", data: {} }),
    ).toEqual({ kind: "unsupported", event: "FINISH_ONLY_WABA" });
  });

  it("ignores everything else", () => {
    expect(parseEmbeddedSignupMessage("not json")).toEqual({ kind: "ignore" });
    expect(parseEmbeddedSignupMessage({ type: "OTHER", event: "FINISH" })).toEqual({ kind: "ignore" });
    expect(parseEmbeddedSignupMessage(null)).toEqual({ kind: "ignore" });
  });
});
