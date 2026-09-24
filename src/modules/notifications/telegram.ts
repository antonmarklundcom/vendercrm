import { env } from "@/lib/config/env";
import type { PushPayload } from "./push";

// Telegram alerts: the free second channel next to web push. One bot for the
// whole platform; each person links their own Telegram chat to their user
// from Ajustes (telegram-links.ts). Sending costs nothing for the platform or
// the business, unlike a WhatsApp template, which is why this is the default
// alert channel and WhatsApp alerts are not built.
//
// Everything that decides something is pure and exported for tests; the two
// functions that talk to Telegram are thin fetch wrappers.

const API = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  return Boolean(
    env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_WEBHOOK_SECRET,
  );
}

/** The link a person taps to open the bot with their one-time token. */
export function telegramDeepLink(username: string, token: string): string {
  return `https://t.me/${username}?start=${encodeURIComponent(token)}`;
}

/** The token out of "/start <token>" (what the deep link makes Telegram send),
 * or null for any other message. */
export function parseStartToken(text: string | null | undefined): string | null {
  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})\s*$/.exec(text?.trim() ?? "");
  return match ? match[1] : null;
}

export function isStopCommand(text: string | null | undefined): boolean {
  return /^\/stop(?:@\w+)?\s*$/.test(text?.trim() ?? "");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The alert as Telegram HTML: bold title, body, and a link back into the CRM
 * when the notification has one. Telegram rejects messages over 4096
 * characters, so the body is cut well before that.
 */
export function formatTelegramText(payload: PushPayload, appUrl: string): string {
  const lines = [`<b>${escapeHtml(payload.title)}</b>`];
  if (payload.body) {
    const body = payload.body.length > 1000 ? `${payload.body.slice(0, 1000)}…` : payload.body;
    lines.push(escapeHtml(body));
  }
  if (payload.url) {
    const href = new URL(payload.url, appUrl).toString();
    lines.push(`<a href="${escapeHtml(href)}">Abrir en el CRM</a>`);
  }
  return lines.join("\n");
}

export type TelegramSendResult = "sent" | "blocked" | "failed";

/**
 * Sends one message. "blocked" means the person blocked the bot or deleted
 * the chat (Telegram answers 403) — the caller unlinks them so nothing keeps
 * trying. Anything else that fails is "failed": worth the job's one retry.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  if (!env.TELEGRAM_BOT_TOKEN) return "failed";
  const res = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return "sent";
  if (res.status === 403) return "blocked";
  return "failed";
}

/**
 * Points the bot at this deployment's webhook. Called once at boot when the
 * feature is configured, so nobody has to run a curl command by hand; it is
 * idempotent on Telegram's side, and a failure only logs — the rest of the
 * app must boot either way.
 */
export async function registerTelegramWebhook(appUrl: string): Promise<void> {
  if (!isTelegramConfigured()) return;
  try {
    const res = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: new URL("/api/webhooks/telegram", appUrl).toString(),
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message"],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[telegram] setWebhook answered ${res.status}`);
  } catch (err) {
    console.error("[telegram] setWebhook failed", err);
  }
}
