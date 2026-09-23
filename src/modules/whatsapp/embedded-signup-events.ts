// Browser-side half of Meta Embedded Signup: reading the `message` events
// Meta's popup posts back to the page that opened it. Kept free of server
// imports (env, db) so the client button can use it and tests can pin it.
//
// Payload shape (sessionInfoVersion 3):
//   { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", version: 3,
//     data: { phone_number_id, waba_id, business_id? } }
// Coexistence (featureType "whatsapp_business_app_onboarding") finishes with
// event "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" and documents waba_id only.
// Abandoning sends event "CANCEL" with data.current_step; a failure inside
// the flow arrives as CANCEL (or ERROR) with data.error_message.

export type EmbeddedSignupEvent =
  | { kind: "finish"; wabaId: string; phoneNumberId?: string; coexistence: boolean }
  /** Finished without a number this app can use (e.g. only a WABA was made). */
  | { kind: "unsupported"; event: string }
  | { kind: "cancel"; step?: string }
  | { kind: "error"; message?: string }
  | { kind: "ignore" };

const COEXISTENCE_FINISH = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";

/**
 * Exact facebook.com or a subdomain of it — not a bare `endsWith`, which
 * would also accept an origin like `https://evilfacebook.com`.
 */
export function isFacebookOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "https:" && (hostname === "facebook.com" || hostname.endsWith(".facebook.com"))
    );
  } catch {
    return false;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Classifies one postMessage payload; anything unexpected is "ignore". */
export function parseEmbeddedSignupMessage(raw: unknown): EmbeddedSignupEvent {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return { kind: "ignore" };
    }
  }
  if (!payload || typeof payload !== "object") return { kind: "ignore" };

  const msg = payload as { type?: unknown; event?: unknown; data?: unknown };
  if (msg.type !== "WA_EMBEDDED_SIGNUP" || typeof msg.event !== "string") {
    return { kind: "ignore" };
  }
  const data = (msg.data && typeof msg.data === "object" ? msg.data : {}) as Record<string, unknown>;
  const event = msg.event;

  if (event === "FINISH" || event === COEXISTENCE_FINISH) {
    const wabaId = str(data.waba_id);
    if (!wabaId) return { kind: "error" };
    return {
      kind: "finish",
      wabaId,
      phoneNumberId: str(data.phone_number_id),
      coexistence: event === COEXISTENCE_FINISH,
    };
  }
  if (event.startsWith("FINISH")) return { kind: "unsupported", event };
  if (event.toUpperCase() === "ERROR") return { kind: "error", message: str(data.error_message) };
  if (event === "CANCEL") {
    // A CANCEL that carries an error_message is a failure inside the flow,
    // not the person closing the popup — the two read differently to them.
    const message = str(data.error_message);
    return message ? { kind: "error", message } : { kind: "cancel", step: str(data.current_step) };
  }
  return { kind: "ignore" };
}
