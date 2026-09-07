import { eq } from "drizzle-orm";
import { messages } from "@/db/schema";
import { getTranslator } from "@/lib/i18n/translator";
import { DEFAULT_COUNTRY, normalizePhone } from "@/lib/phone";
import { getContact } from "@/modules/crm/contacts";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { sendText } from "@/modules/whatsapp/send";
import { buildHoy } from "./hoy";

// The second half of §15.3's Lane A: the owner sends a voice note to the
// business's own WhatsApp number and gets today's list back. Deliberately
// *not* a chatbot — that is L3 (J8), and it needs tools and a month of L1/L2
// in real use first. This matches a short list of ways of asking one
// question and stays silent for everything else, so an owner who sends a
// voice note about something else is never answered by a robot.

/** How many rows fit in a WhatsApp message a person will actually read. */
const MAX_ITEMS = 5;

/**
 * The ways an owner asks "what have I got". Matched on the transcript with
 * accents and punctuation stripped, because a transcription writes "qué" or
 * "que" depending on the provider and the day.
 */
const INTENT_PATTERNS = [
  /\bhoy\b/,
  /\bque tengo\b/,
  /\bque hay\b/,
  /\bpendiente/,
  /\btareas\b/,
  /\bagenda\b/,
];

export function normalizeForIntent(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure, and exported: the rule the tests assert and the handler applies. */
export function matchesCoachIntent(text: string): boolean {
  const normalized = normalizeForIntent(text);
  if (!normalized) return false;
  return INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export type CoachVoiceOutcome =
  | { status: "answered"; items: number }
  | { status: "ignored"; reason: "not_transcribed" | "not_owner" | "no_intent" | "not_configured" };

/**
 * Answers a transcribed voice note from the owner's own number with the
 * ranked "Hoy" list — the same one the dashboard and the morning digest
 * show, built by `buildHoy` rather than re-derived here, so all three can
 * never disagree.
 */
export async function maybeAnswerCoachVoiceNote(
  ctx: TenantContext,
  input: { messageId: string; conversationId: string; contactId: string },
  now: Date = new Date(),
): Promise<CoachVoiceOutcome> {
  const tenant = await getTenant(ctx.tenantId);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const coachPhone = settings.coachPhone?.trim();
  if (!coachPhone) return { status: "ignored", reason: "not_configured" };

  const [message] = await tenantDb(ctx).select(messages, eq(messages.id, input.messageId));
  if (!message || message.direction !== "in" || message.transcriptStatus !== "done") {
    return { status: "ignored", reason: "not_transcribed" };
  }
  const transcript = (message.transcript ?? "").trim();
  if (!transcript) return { status: "ignored", reason: "not_transcribed" };

  const contact = await getContact(ctx, input.contactId);
  const country = settings.defaultCountry ?? DEFAULT_COUNTRY;
  if (!contact || normalizePhone(contact.phone, country) !== normalizePhone(coachPhone, country)) {
    return { status: "ignored", reason: "not_owner" };
  }

  if (!matchesCoachIntent(transcript)) return { status: "ignored", reason: "no_intent" };

  const items = await buildHoy(ctx, now);
  const t = await getTranslator(tenant?.locale, "app.dashboard.hoy");

  const body =
    items.length === 0
      ? t("voice.empty")
      : [
          t("voice.intro", { count: items.length }),
          ...items.slice(0, MAX_ITEMS).map((item, index) => `${index + 1}. ${item.title}`),
        ].join("\n");

  await sendText(ctx, { conversationId: input.conversationId, body });
  return { status: "answered", items: items.length };
}
