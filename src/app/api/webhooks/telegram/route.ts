import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { reportError } from "@/lib/observability";
import {
  isStopCommand,
  isTelegramConfigured,
  parseStartToken,
  sendTelegramMessage,
} from "@/modules/notifications/telegram";
import {
  consumeTelegramLinkToken,
  unlinkTelegramChat,
} from "@/modules/notifications/telegram-links";

// The platform bot's webhook. It only ever handles two things: "/start
// <token>" from the "Conectar Telegram" deep link, which links the chat to
// the person who tapped it, and "/stop", which unlinks it. Everything else
// gets a one-line answer saying what the bot is for.
//
// Telegram proves the call is theirs by echoing TELEGRAM_WEBHOOK_SECRET in
// X-Telegram-Bot-Api-Secret-Token (registered in registerTelegramWebhook).
// Always 200 once authenticated: Telegram retries anything else, and there is
// nothing a retry would fix.

function secretMatches(provided: string | null): boolean {
  if (!provided || !env.TELEGRAM_WEBHOOK_SECRET) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(env.TELEGRAM_WEBHOOK_SECRET));
}

type TelegramUpdate = {
  message?: { text?: string; chat?: { id?: number | string; type?: string } };
};

export async function POST(request: Request) {
  if (!isTelegramConfigured()) return new NextResponse("Not found", { status: 404 });
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chat = update.message?.chat;
  // Private chats only: a bot added to a group must not become a way to
  // pipe a business's alerts into a room full of other people.
  if (!chat?.id || chat.type !== "private") return NextResponse.json({ ok: true });
  const chatId = String(chat.id);
  const text = update.message?.text;

  try {
    const token = parseStartToken(text);
    if (token) {
      const linked = await consumeTelegramLinkToken(token, chatId);
      await sendTelegramMessage(
        chatId,
        linked
          ? "✅ Listo. Desde ahora te avisamos acá cuando entre un mensaje, te asignen algo o venza una tarea. Para dejar de recibir avisos, escribí /stop."
          : "Ese enlace ya venció. Volvé a Ajustes en el CRM y tocá «Conectar Telegram» otra vez.",
      );
    } else if (isStopCommand(text)) {
      await unlinkTelegramChat(chatId);
      await sendTelegramMessage(chatId, "Listo, no te vamos a mandar más avisos por acá.");
    } else {
      await sendTelegramMessage(
        chatId,
        "Este bot solo envía avisos del CRM. Para conectarlo, entrá a Ajustes y tocá «Conectar Telegram».",
      );
    }
  } catch (err) {
    reportError(err, { tags: { route: "telegram.webhook" } });
  }

  return NextResponse.json({ ok: true });
}
