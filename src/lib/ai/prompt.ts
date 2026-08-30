import type { AiGenerateInput, AiTurn } from "./types";

// The one place a prompt is assembled (PLAN.md §10 1O: "tenant settings hold
// the business context the model needs"). Pure and side-effect free so it is
// directly unit-testable — the guardrail paragraph below is the part that
// must not silently drift, since it is what stands between the model and an
// invented price in guaraníes.

export type BusinessContext = {
  businessName: string;
  /** What the company sells, in the tenant's own words. */
  about?: string;
  tone?: string;
  hours?: string;
  /** Things the model must never promise: prices, delivery dates, discounts. */
  neverPromise?: string;
  /** Extra per-node instructions from the flow's ai_reply node. */
  instructions?: string;
  /**
   * Bookable types the assistant may offer, when the tenant has turned
   * booking on. Empty or absent means the marker below is never mentioned,
   * so a tenant who has not opted in gets exactly the prompt they had.
   */
  bookableTypes?: Array<{ slug: string; name: string }>;
};

/**
 * How the model asks for the slot picker (plan-booking.md §5.3).
 *
 * Deliberately a marker in the text rather than provider-native tool calls.
 * Two reasons, and the second is the important one. First, the driver
 * interface is prompt-in-string-out for both OpenAI and Gemini, so native
 * tools would mean two provider-specific implementations of the same idea.
 * Second — and this is why it stays this way even if that changes — the
 * model never books anything. It can *offer* times; the customer's tap is
 * what reserves, through the same transaction the public page uses. A model
 * that cannot write to the database cannot hallucinate an appointment into
 * existence, and "confirm with the customer before reserving" stops being a
 * prompt instruction the model might ignore and becomes the shape of the
 * system.
 */
export const BOOKING_MARKER = /\[\[SLOTS:([a-z0-9-]{1,100})\]\]/i;

export type BookingIntent = { text: string; bookingTypeSlug: string | null };

/**
 * Splits a generated reply into the text to send and the slots to offer.
 *
 * Pure, and tested — the marker must be stripped whether or not the slug is
 * one this tenant actually has, because a customer should never see
 * `[[SLOTS:corte]]` in a WhatsApp message.
 */
export function extractBookingIntent(reply: string): BookingIntent {
  const match = reply.match(BOOKING_MARKER);
  if (!match) return { text: reply.trim(), bookingTypeSlug: null };
  return {
    text: reply.replace(BOOKING_MARKER, "").replace(/\s{2,}/g, " ").trim(),
    bookingTypeSlug: match[1].toLowerCase(),
  };
}

/** Kept in Spanish because the product is Spanish-only (§1.2). */
const GUARDRAILS = [
  "Escribí en español paraguayo, natural y breve (máximo 3 frases).",
  "Nunca inventes precios, plazos de entrega, descuentos ni disponibilidad de stock.",
  "Si no sabés algo, decí que un asesor humano va a responder enseguida.",
  "No prometas nada que no esté explícitamente en el contexto del negocio.",
  "No pidas datos sensibles (contraseñas, números de tarjeta, documentos).",
  "Respondé solo con el texto del mensaje, sin comillas ni encabezados.",
];

export function buildSystemPrompt(business: BusinessContext): string {
  const lines = [
    `Sos el asistente de atención al cliente de "${business.businessName}" y respondés por WhatsApp.`,
  ];

  if (business.about) lines.push(`Sobre el negocio: ${business.about}`);
  if (business.tone) lines.push(`Tono de las respuestas: ${business.tone}`);
  if (business.hours) lines.push(`Horario de atención: ${business.hours}`);
  if (business.neverPromise) lines.push(`Nunca prometas: ${business.neverPromise}`);
  if (business.instructions) lines.push(`Instrucción de este flujo: ${business.instructions}`);

  lines.push("Reglas obligatorias:");
  for (const rule of GUARDRAILS) lines.push(`- ${rule}`);

  const bookable = business.bookableTypes ?? [];
  if (bookable.length > 0) {
    lines.push(
      "Si el cliente quiere agendar un turno, terminá tu mensaje con el marcador " +
        "[[SLOTS:slug]] usando uno de estos servicios:",
    );
    for (const type of bookable) lines.push(`- ${type.slug} — ${type.name}`);
    lines.push(
      "El sistema le va a mostrar los horarios libres para que toque el que quiera. " +
        "Nunca digas vos un horario concreto ni des una reserva por confirmada: " +
        "eso lo hace el cliente tocando la opción.",
    );
  }

  return lines.join("\n");
}

/**
 * The last `limit` messages of the conversation, oldest first. Outbound
 * messages become assistant turns and inbound ones user turns, so the model
 * sees the thread the way the customer does. Empty bodies (media-only
 * messages) are dropped rather than sent as blank turns.
 */
export function toTurns(
  messages: Array<{ direction: "in" | "out"; body: string | null }>,
  limit = 20,
): AiTurn[] {
  return messages
    .filter((message) => (message.body ?? "").trim().length > 0)
    .slice(-limit)
    .map((message) => ({
      role: message.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: (message.body ?? "").trim(),
    }));
}

export function buildReplyPrompt(
  business: BusinessContext,
  messages: Array<{ direction: "in" | "out"; body: string | null }>,
): AiGenerateInput {
  return { system: buildSystemPrompt(business), messages: toTurns(messages) };
}

/**
 * What gets persisted alongside every generated reply for audit (§10 1O:
 * "every AI message stored with its prompt and model"). Flattened to text so
 * the stored prompt is readable in the UI without re-deriving anything.
 */
export function serialisePrompt(input: AiGenerateInput): string {
  const turns = input.messages.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
  return `${input.system}\n\n---\n${turns}`;
}
