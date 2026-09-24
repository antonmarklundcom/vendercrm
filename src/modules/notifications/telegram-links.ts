import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

// Linking a Telegram chat to a user. Personal, like push subscriptions: a
// person's chat follows them into every business they belong to, and the
// active-membership check in the send path (jobs.ts) decides per business
// whether they still hear about it.
//
// The flow is two taps: "Conectar Telegram" in Ajustes stores a one-time
// token and opens t.me/<bot>?start=<token>; pressing Start makes Telegram
// post "/start <token>" to the webhook, which swaps the token for the chat id.

/** Long enough to type from a phone never; short enough to still be tapped. */
export const LINK_TOKEN_TTL_MS = 30 * 60 * 1000;

export async function createTelegramLinkToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db
    .update(users)
    .set({
      telegramLinkToken: token,
      telegramLinkExpiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MS),
    })
    .where(eq(users.id, userId));
  return token;
}

/** Swaps a live token for the chat id. Returns false for an unknown or
 * expired token — the webhook answers the person either way. */
export async function consumeTelegramLinkToken(token: string, chatId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.telegramLinkToken, token), gt(users.telegramLinkExpiresAt, new Date())));
  if (!row) return false;

  // One chat, one user: a phone that was linked to another account (a shared
  // shop phone handed to a new seller) moves over rather than alerting both.
  await db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, chatId));
  await db
    .update(users)
    .set({ telegramChatId: chatId, telegramLinkToken: null, telegramLinkExpiresAt: null })
    .where(eq(users.id, row.id));
  return true;
}

export async function unlinkTelegramForUser(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ telegramChatId: null, telegramLinkToken: null, telegramLinkExpiresAt: null })
    .where(eq(users.id, userId));
}

/** The person blocked the bot or sent /stop: stop sending to that chat. */
export async function unlinkTelegramChat(chatId: string): Promise<void> {
  await db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, chatId));
}
