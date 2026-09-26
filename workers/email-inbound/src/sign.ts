// HMAC-SHA256 over `${timestamp}.${body}`, hex — WebCrypto twin of
// src/modules/mailbox/signature.ts in the app. Tested against it there.

export const TIMESTAMP_HEADER = "x-vendercrm-timestamp";
export const SIGNATURE_HEADER = "x-vendercrm-signature";

export async function signInbound(secret: string, timestamp: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
