import { randomInt } from "node:crypto";
import { env } from "@/lib/config/env";
import type { TenantContext } from "@/modules/tenancy/context";
import { resolveAccountByPhoneNumberId, storeConnectedAccount } from "./accounts";
import { GRAPH_API_BASE, GRAPH_API_VERSION, GRAPH_TIMEOUT_MS } from "./graph";

// Meta Embedded Signup — the one-click alternative to pasting a WABA id,
// phone number id and token by hand (PLAN.md §6.2). The browser runs Meta's
// popup (FB.login with the owner's Embedded Signup configuration) and hands
// this module three things: a short-lived `code` and the WABA / phone number
// ids from the WA_EMBEDDED_SIGNUP message event. Everything that needs the
// app secret happens here, server-side.
//
// Order matters: every read (token, phone lookup, duplicate check) runs
// before the first call that changes something at Meta, and nothing is
// written to wa_accounts until the webhook subscription (and, for a Cloud
// API number, registration) has succeeded — a half-connected row would
// look usable to the send path while inbound messages never arrive.
//
// Each Graph call is its own small function so a Meta-side change touches
// one place, and so the tests can assert on each request separately.

/** "cloud_api": a new number moved to the Cloud API. "coexistence": the
 * business keeps using the WhatsApp Business app on the same number. */
export type EmbeddedSignupMode = "cloud_api" | "coexistence";

export type EmbeddedSignupError =
  | "notConfigured"
  | "codeExchangeFailed"
  | "phoneLookupFailed"
  | "phoneNumberNotFound"
  | "numberAlreadyConnected"
  | "subscribeFailed"
  | "registerFailed"
  | "storeFailed";

export type EmbeddedSignupInput = {
  code: string;
  wabaId: string;
  /** Absent on coexistence completions, which Meta documents with waba_id only. */
  phoneNumberId?: string;
  mode: EmbeddedSignupMode;
};

export type EmbeddedSignupResult =
  | { ok: true; accountId: string; wabaId: string; phoneNumberId: string }
  | { ok: false; error: EmbeddedSignupError };

/**
 * What the browser needs to open the popup, or null while the owner has not
 * configured Embedded Signup — in which case no button renders at all. Read
 * server-side and passed down as props (same rule as the web push key in
 * env.ts), so turning the feature on is an env change and a restart, not a
 * rebuild. Neither value is a secret; the app secret never leaves here.
 */
export function embeddedSignupClientConfig():
  | { appId: string; configId: string; graphVersion: string }
  | null {
  if (!env.META_APP_ID || !env.META_EMBEDDED_SIGNUP_CONFIG_ID) return null;
  return {
    appId: env.META_APP_ID,
    configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID,
    graphVersion: GRAPH_API_VERSION,
  };
}

class GraphError extends Error {
  constructor(
    readonly step: string,
    readonly status: number,
    readonly metaCode: number | undefined,
    metaMessage: string | undefined,
  ) {
    super(`${step} failed: HTTP ${status}${metaCode ? ` (${metaCode})` : ""} ${metaMessage ?? ""}`.trim());
  }
}

/**
 * Meta's error envelope is `{ error: { message, code } }`. Only that is kept
 * for the log line: Graph error bodies do not echo tokens, but a raw body is
 * still not something to pass along wholesale.
 */
async function graphFail(step: string, res: Response): Promise<GraphError> {
  let code: number | undefined;
  let message: string | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: number; message?: string } };
    code = body.error?.code;
    message = body.error?.message?.slice(0, 200);
  } catch {
    // Non-JSON error body — the status alone has to do.
  }
  return new GraphError(step, res.status, code, message);
}

/**
 * Exchanges the popup's code for a business integration token.
 * GET /oauth/access_token?client_id&client_secret&code — no redirect_uri,
 * because the code came from the JS SDK rather than a redirect. The app
 * secret is WHATSAPP_APP_SECRET: this is the same single platform Meta app
 * that signs webhooks (PLAN.md §6.1), so META_APP_ID must be that app's id.
 */
export async function exchangeCodeForToken(code: string, appId: string): Promise<string> {
  const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", env.WHATSAPP_APP_SECRET);
  url.searchParams.set("code", code);
  const res = await fetch(url, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  if (!res.ok) throw await graphFail("token exchange", res);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new GraphError("token exchange", res.status, undefined, "no access_token");
  return body.access_token;
}

export type WabaPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
};

/**
 * GET /{waba_id}/phone_numbers. Used for both modes rather than reading the
 * phone number id directly: it confirms the number actually belongs to the
 * WABA the token was granted for (the ids arrive from the browser), and it
 * is how a coexistence signup — whose event carries no phone_number_id —
 * finds its number.
 */
export async function listWabaPhoneNumbers(
  wabaId: string,
  token: string,
): Promise<WabaPhoneNumber[]> {
  const url = new URL(`${GRAPH_API_BASE}/${encodeURIComponent(wabaId)}/phone_numbers`);
  url.searchParams.set("fields", "id,display_phone_number,verified_name");
  url.searchParams.set("limit", "100");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  });
  if (!res.ok) throw await graphFail("phone number lookup", res);
  const body = (await res.json()) as { data?: WabaPhoneNumber[] };
  return body.data ?? [];
}

/**
 * POST /{waba_id}/subscribed_apps — subscribes the app that owns the token
 * (this platform's app) to the WABA's webhooks. Without it Meta never sends
 * this tenant's inbound messages to our /api/webhooks endpoint.
 */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  const res = await fetch(`${GRAPH_API_BASE}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  });
  if (!res.ok) throw await graphFail("webhook subscription", res);
  const body = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (body.success === false) throw new GraphError("webhook subscription", res.status, undefined, "success=false");
}

/**
 * POST /{phone_number_id}/register — activates the number on the Cloud API.
 * The pin becomes the number's two-step verification PIN when none is set;
 * if the business already set one, Meta rejects a different pin and the
 * admin is told to turn two-step verification off (or use the manual form).
 * Never called for coexistence: that number stays registered to the
 * WhatsApp Business app, and Meta's coexistence flow skips this step.
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  pin: string,
): Promise<void> {
  const res = await fetch(`${GRAPH_API_BASE}/${encodeURIComponent(phoneNumberId)}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  });
  if (!res.ok) throw await graphFail("phone registration", res);
}

/** Six digits, never starting with 0 so no layer can strip it to five. */
export function generateRegistrationPin(): string {
  return String(randomInt(100_000, 1_000_000));
}

function logFailure(err: unknown) {
  // Step, HTTP status and Meta's own error code/message — enough for an
  // operator to act on; never the token or the code.
  console.error("[whatsapp] embedded signup:", err instanceof Error ? err.message : "unknown error");
}

/**
 * The whole server half of Embedded Signup for one tenant. Returns an error
 * key (translated by the calling page) instead of throwing, so a failed
 * signup lands as an inline message next to the button.
 */
export async function completeEmbeddedSignup(
  ctx: TenantContext,
  input: EmbeddedSignupInput,
): Promise<EmbeddedSignupResult> {
  const config = embeddedSignupClientConfig();
  if (!config) return { ok: false, error: "notConfigured" };

  let token: string;
  try {
    token = await exchangeCodeForToken(input.code, config.appId);
  } catch (err) {
    logFailure(err);
    return { ok: false, error: "codeExchangeFailed" };
  }

  let numbers: WabaPhoneNumber[];
  try {
    numbers = await listWabaPhoneNumbers(input.wabaId, token);
  } catch (err) {
    logFailure(err);
    return { ok: false, error: "phoneLookupFailed" };
  }

  // A provided id is authoritative — no falling back to another number on a
  // multi-number WABA. Without one, only a sole number is unambiguous.
  const phone = input.phoneNumberId
    ? numbers.find((n) => n.id === input.phoneNumberId)
    : numbers.length === 1
      ? numbers[0]
      : undefined;
  if (!phone) return { ok: false, error: "phoneNumberNotFound" };

  // phone_number_id is unique platform-wide (webhook routing, §6.3). Checked
  // before anything changes at Meta, so a duplicate is refused cleanly
  // instead of failing on insert after the number was already registered.
  if (await resolveAccountByPhoneNumberId(phone.id)) {
    return { ok: false, error: "numberAlreadyConnected" };
  }

  try {
    await subscribeAppToWaba(input.wabaId, token);
  } catch (err) {
    logFailure(err);
    return { ok: false, error: "subscribeFailed" };
  }
  const subscribedAt = new Date();

  if (input.mode === "cloud_api") {
    try {
      await registerPhoneNumber(phone.id, token, generateRegistrationPin());
    } catch (err) {
      logFailure(err);
      return { ok: false, error: "registerFailed" };
    }
  }

  try {
    const account = await storeConnectedAccount(ctx, {
      wabaId: input.wabaId,
      phoneNumberId: phone.id,
      displayNumber: phone.display_phone_number?.slice(0, 30),
      verifiedName: phone.verified_name?.slice(0, 200),
      accessToken: token,
      connectedVia: "embedded",
      webhookSubscribedAt: subscribedAt,
    });
    if (!account) return { ok: false, error: "storeFailed" };
    return { ok: true, accountId: account.id, wabaId: input.wabaId, phoneNumberId: phone.id };
  } catch {
    // Not logFailure(err): a failed-query error carries the insert's
    // parameters, and those include the (encrypted) token columns.
    console.error("[whatsapp] embedded signup: storing the account failed");
    return { ok: false, error: "storeFailed" };
  }
}
