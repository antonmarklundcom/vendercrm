import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config/env";

// Stateless unsubscribe link (PLAN.md §15.1, §15.8 P4): `/u/[token]` sets the
// same `optout` tag the WhatsApp keyword sets (modules/automations/actions.ts's
// OPTOUT_TAG), so one flag governs both channels. No table — the token
// carries tenant id + contact id itself, HMAC-signed so it can't be forged
// or edited to unsubscribe someone else's contact.
//
// Reuses APP_ENCRYPTION_KEY as the HMAC key rather than adding a new secret:
// it is already a securely provisioned 32-byte value, and HMAC signing is a
// different operation from the AES-256-GCM secrets-at-rest use §3.4 reserves
// it for — this never decrypts anything, it only signs.

function sign(payload: string): string {
  return createHmac("sha256", env.APP_ENCRYPTION_KEY).update(payload).digest("hex").slice(0, 32);
}

export function buildUnsubscribeToken(tenantId: string, contactId: string): string {
  const payload = `${tenantId}:${contactId}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export function buildUnsubscribeUrl(tenantId: string, contactId: string): string {
  return `${env.APP_URL}/u/${buildUnsubscribeToken(tenantId, contactId)}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { tenantId: string; contactId: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [tenantId, contactId] = payload.split(":");
  if (!tenantId || !contactId) return null;
  return { tenantId, contactId };
}
