import crypto from "node:crypto";
import { CRM_URL } from "@/lib/config/hosts";

/**
 * Server-side client for our own public lead endpoint (`vendercrm-lead-capture`
 * skill). The marketing site is a site like any other customer site: it holds
 * a site API key and posts server-to-server. That is deliberate rather than
 * calling `ingestLead()` in-process — the brand's own leads then travel the
 * exact path a customer's leads travel, so a break in the ingest contract
 * shows up on our own site first, and the site row gives per-site lead
 * reporting for free.
 *
 * The key must be `VENDERCRM_API_KEY` with no `NEXT_PUBLIC_` prefix — a
 * prefixed name is inlined into the client bundle and lets anyone write into
 * the pipeline.
 */

const CRM_ENDPOINT = `${process.env.VENDERCRM_URL ?? CRM_URL}/api/v1/leads`;

export type Lead = {
  phone: string;
  name?: string;
  email?: string;
  message?: string;
  source?: string;
  page_url?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  idempotency_key: string;
  fields?: Record<string, unknown>;
};

/**
 * Same phone within the same hour is the same submission. This collapses the
 * double-click and the timed-out-but-succeeded retry into one contact, while
 * still letting the same person enquire again tomorrow.
 */
export function idempotencyKey(phone: string): string {
  return crypto
    .createHash("sha256")
    .update(`${phone}|${new Date().toISOString().slice(0, 13)}`)
    .digest("hex");
}

/** First-touch attribution cookie written by /vc-attribution.js. */
export function readAttribution(cookieValue: string | undefined): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(cookieValue ?? "%7B%7D"));
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value !== "")
        .map(([key, value]) => [key, value as string]),
    );
  } catch {
    return {};
  }
}

export type SendLeadResult = { ok: boolean; status: number };

/**
 * Never throws. A visitor who filled in the form and got an error page is a
 * lost customer; a logged failure is a five-minute fix — so the caller can
 * always thank them, even when the CRM is down.
 */
export async function sendLead(lead: Lead): Promise<SendLeadResult> {
  const apiKey = process.env.VENDERCRM_API_KEY;
  if (!apiKey) {
    console.error("VenderCRM lead skipped: VENDERCRM_API_KEY is not set");
    return { ok: false, status: 0 };
  }

  // Omit empty values rather than sending "": the endpoint rejects an empty
  // string on `email` with a 422.
  const body = Object.fromEntries(
    Object.entries(lead).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );

  try {
    const response = await fetch(CRM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!response.ok) {
      // The response body names the failing field — logging only the status
      // turns a one-line fix into an afternoon.
      console.error("VenderCRM lead failed", response.status, await response.text());
    }
    return { ok: response.ok, status: response.status };
  } catch (error) {
    console.error("VenderCRM unreachable", error);
    return { ok: false, status: 0 };
  }
}
