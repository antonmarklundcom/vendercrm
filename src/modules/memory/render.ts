import type { BusinessFact } from "./facts";
import type { BusinessProfile } from "./profile";

// The memory as the model sees it (PLAN.md §16.4). Pure, so the block that
// replaces the five free-text `settings.ai` fields in every prompt is
// directly testable — and so a change to the wording shows up as a diff in a
// test rather than as a drift in production replies.
//
// Spanish, voseo, and deliberately terse: every line costs tokens on every
// reply of every conversation.

export type MemoryAudience = "customer" | "internal";

/**
 * Only the profile fields the block actually prints. Narrow on purpose: it
 * lets the one-release fallback for a tenant with no profile row (the old
 * `settings.ai` free text — §16.3 "Migration") be rendered by exactly the
 * same code as a real profile, instead of a second rendering path that
 * would drift.
 */
export type RenderableProfile = Pick<
  BusinessProfile,
  | "displayName"
  | "about"
  | "audience"
  | "differentiators"
  | "tone"
  | "toneNote"
  | "address"
  | "mapsUrl"
  | "website"
  | "paymentMethods"
  | "neverPromise"
>;

export type MemorySelection = {
  audience: MemoryAudience;
  profile: RenderableProfile | null;
  /** Business name to fall back to when the profile has no display name. */
  businessName: string;
  /** Opening hours, already rendered to one line by the caller. */
  hours: string | null;
  /** policy / location / contact — always included (§16.4). */
  always: BusinessFact[];
  /** FAQs and services picked by relevance to the customer's question. */
  matched: BusinessFact[];
  /** Promos whose dates cover today. */
  promos: BusinessFact[];
  /** Internal notes — only ever present when audience is "internal". */
  internal: BusinessFact[];
  /** True when the budget cut something; the caller may want to log it. */
  truncated: boolean;
};

/**
 * The estimate the budget is spent against: characters over four. Crude on
 * purpose — an exact count needs the provider's tokenizer, which would mean
 * a dependency and a per-provider answer for a number whose only job is to
 * stop a prompt growing without bound.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const TONE_LABELS: Record<string, string> = {
  cercano: "cercano y amable",
  formal: "formal y respetuoso",
  directo: "directo y breve",
};

export function renderMemoryBlock(selection: MemorySelection): string {
  const { profile } = selection;
  const lines: string[] = ["Memoria del negocio (usá solo estos datos):"];

  lines.push(`Negocio: ${profile?.displayName?.trim() || selection.businessName}`);
  if (profile?.about) lines.push(`Qué hacemos: ${oneLine(profile.about)}`);
  if (profile?.audience) lines.push(`A quién atendemos: ${oneLine(profile.audience)}`);
  if (profile?.differentiators) {
    lines.push(`Qué nos diferencia: ${oneLine(profile.differentiators)}`);
  }

  const tone = [
    profile?.tone ? (TONE_LABELS[profile.tone] ?? profile.tone) : null,
    profile?.toneNote ? oneLine(profile.toneNote) : null,
  ]
    .filter(Boolean)
    .join(" — ");
  if (tone) lines.push(`Tono: ${tone}`);

  if (selection.hours) lines.push(`Horario: ${oneLine(selection.hours)}`);
  if (profile?.address) {
    lines.push(
      `Dirección: ${oneLine(profile.address)}${profile.mapsUrl ? ` (mapa: ${profile.mapsUrl})` : ""}`,
    );
  }
  if (profile?.website) lines.push(`Web: ${profile.website}`);
  const payment = profile?.paymentMethods ?? [];
  if (payment.length > 0) lines.push(`Formas de pago: ${payment.join(", ")}`);
  if (profile?.neverPromise) lines.push(`Nunca prometas: ${oneLine(profile.neverPromise)}`);

  pushSection(lines, "Políticas y datos del local", selection.always);
  pushSection(lines, "Servicios, precios y preguntas frecuentes", selection.matched);
  pushSection(lines, "Promociones vigentes", selection.promos);

  if (selection.audience === "internal" && selection.internal.length > 0) {
    pushSection(
      lines,
      "Notas internas (nunca las compartas con un cliente)",
      selection.internal,
    );
  }

  return lines.join("\n");
}

function pushSection(lines: string[], heading: string, facts: BusinessFact[]): void {
  if (facts.length === 0) return;
  lines.push(`${heading}:`);
  for (const fact of facts) lines.push(`- ${renderFact(fact)}`);
}

/**
 * One fact, one line. Exported because the budget is spent per fact: the
 * packer measures exactly the string that will end up in the prompt rather
 * than an approximation of it.
 */
export function renderFact(fact: BusinessFact): string {
  const parts: string[] = [];
  const structured = (fact.structured ?? {}) as Record<string, unknown>;

  if (fact.kind === "policy" && typeof structured.topic === "string") {
    parts.push(`[${POLICY_LABELS[structured.topic] ?? structured.topic}]`);
  }

  parts.push(fact.title.trim());

  if (fact.kind === "service") {
    const price = typeof structured.price === "number" ? structured.price : null;
    if (price !== null) {
      parts.push(`— ${structured.priceFrom === true ? "desde " : ""}${formatGs(price)}`);
    }
    const duration =
      typeof structured.durationMinutes === "number" ? structured.durationMinutes : null;
    if (duration) parts.push(`— ${duration} min`);
  }

  if (fact.kind === "promo") {
    const until = typeof structured.validUntil === "string" ? structured.validUntil : null;
    if (until) parts.push(`— hasta ${until}`);
  }

  if (fact.body) parts.push(`— ${oneLine(fact.body)}`);
  return parts.join(" ");
}

const POLICY_LABELS: Record<string, string> = {
  cancellation: "Cancelación",
  deposit: "Seña",
  payment: "Pago",
  warranty: "Garantía",
  other: "Política",
};

/**
 * Guaraníes with a thousands dot and no decimals, written here rather than
 * through Intl so the prompt is byte-identical wherever it is built — a
 * container with a trimmed ICU would otherwise produce a different prompt
 * from CI's.
 */
export function formatGs(amount: number): string {
  const digits = Math.round(Math.abs(amount)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "-" : ""}${grouped} Gs`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<(typeof DAY_ORDER)[number], string> = {
  mon: "Lun",
  tue: "Mar",
  wed: "Mié",
  thu: "Jue",
  fri: "Vie",
  sat: "Sáb",
  sun: "Dom",
};

/**
 * The structured `settings.businessHours` as one line a model can quote
 * ("Lun a Vie 08:00–17:00, Sáb 08:00–12:00"). Consecutive days with the same
 * range are collapsed, because a seven-line schedule in every prompt is six
 * lines of budget spent saying the same thing.
 */
export function formatBusinessHours(
  hours: Partial<Record<(typeof DAY_ORDER)[number], { start: string; end: string } | null>> | null | undefined,
): string | null {
  if (!hours) return null;

  const groups: Array<{ from: string; to: string; range: string }> = [];
  for (const day of DAY_ORDER) {
    const value = hours[day];
    if (!value) continue;
    const range = `${value.start}–${value.end}`;
    const last = groups[groups.length - 1];
    const previousIndex = DAY_ORDER.indexOf(day) - 1;
    const previous = previousIndex >= 0 ? DAY_ORDER[previousIndex] : null;
    if (last && last.range === range && previous && last.to === previous) {
      last.to = day;
    } else {
      groups.push({ from: day, to: day, range });
    }
  }
  if (groups.length === 0) return null;

  return groups
    .map((group) =>
      group.from === group.to
        ? `${DAY_LABELS[group.from as (typeof DAY_ORDER)[number]]} ${group.range}`
        : `${DAY_LABELS[group.from as (typeof DAY_ORDER)[number]]} a ${DAY_LABELS[group.to as (typeof DAY_ORDER)[number]]} ${group.range}`,
    )
    .join(", ");
}
