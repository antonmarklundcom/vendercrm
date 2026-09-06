import { z } from "zod";

// The weekly briefing's narrative (PLAN.md §15.3 L2, §17.3 P14) — pure, no
// db client, so it is unit-testable without a configured environment (same
// discipline as coach/rank.ts).
//
// The numbers are the model's input, never its output: `templateNarrative`
// is built directly from the metric set every tenant gets regardless of AI,
// and `verifyNarrative` is the post-check that keeps the AI path honest —
// every cited metric key must exist and every number appearing in the
// model's prose must be one this week's data actually produced.

export const BRIEFING_SCHEMA = z.object({
  summary: z.string().min(1),
  recommendations: z.array(z.string().min(1)).length(3),
  citedMetrics: z.array(z.string()),
});

export type BriefingGeneration = z.infer<typeof BRIEFING_SCHEMA>;

export type BriefingMetrics = Record<string, number>;

export type BriefingInput = {
  metrics: BriefingMetrics;
  businessName: string;
  /** For money formatting in the template narrative. */
  currency: string;
  locale: string;
};

/**
 * Numbers a generated narrative could plausibly cite, pulled out of free
 * text. Money is printed with thousands separators ("5.000.000"), so
 * separators are stripped before comparing against the metric set; anything
 * under two digits is skipped; a bare list marker ("1.", "2.") reads the
 * same as a real single-digit metric and would be indistinguishable from
 * one, so single digits are simply not checked — every metric this phase
 * produces that matters for hallucination-catching (counts of stale deals,
 * leads, money) is two digits or more in the cases that count.
 */
function numbersIn(text: string): number[] {
  const matches = text.match(/\d[\d.,]*\d/g) ?? [];
  return matches
    .map((raw) => Number(raw.replace(/[.,]/g, "")))
    .filter((value) => Number.isFinite(value));
}

/**
 * True when every `citedMetrics` key is one the input actually has, and
 * every number in the summary + recommendations is a value from the input's
 * own metric set — so a model that invents "47 leads" when the real count
 * is 12 fails this check and the caller falls back to the template.
 */
export function verifyNarrative(
  generation: Pick<BriefingGeneration, "summary" | "recommendations" | "citedMetrics">,
  input: Pick<BriefingInput, "metrics">,
): boolean {
  for (const key of generation.citedMetrics) {
    if (!(key in input.metrics)) return false;
  }

  const allowed = new Set(Object.values(input.metrics).map((value) => Math.trunc(value)));
  const text = [generation.summary, ...generation.recommendations].join(" ");
  for (const value of numbersIn(text)) {
    if (!allowed.has(value)) return false;
  }
  return true;
}

/** The deterministic Spanish voseo narrative every tenant gets — what a
 *  tenant with `AI_DRIVER=none` sees, and what any AI failure falls back to. */
export function templateNarrative(
  input: BriefingInput,
): Pick<BriefingGeneration, "summary" | "recommendations"> {
  const m = input.metrics;
  const money = (value: number) =>
    new Intl.NumberFormat(input.locale, { maximumFractionDigits: 0 }).format(value);

  const leadsDelta = m.leadsThisWeek - m.leadsLastWeek;
  const leadsTrend =
    leadsDelta > 0
      ? `${leadsDelta} más que la semana pasada`
      : leadsDelta < 0
        ? `${Math.abs(leadsDelta)} menos que la semana pasada`
        : "igual que la semana pasada";

  const summary =
    `Esta semana ${input.businessName} recibió ${m.leadsThisWeek} leads (${leadsTrend}) y ganó ` +
    `${m.dealsWonThisWeek} negocios por ${money(m.wonValueThisWeek)} ${input.currency}. ` +
    (m.responseMedianMinutes > 0
      ? `El tiempo de respuesta típico fue de ${Math.round(m.responseMedianMinutes)} minutos.`
      : "Todavía no hay suficientes conversaciones para medir el tiempo de respuesta.");

  const recommendations = [
    m.staleDeals > 0
      ? `Tenés ${m.staleDeals} negocios estancados — revisalos hoy.`
      : "Ningún negocio estancado esta semana — seguí así.",
    m.unrepliedQuotes > 0
      ? `${m.unrepliedQuotes} presupuestos enviados sin respuesta — hacé un seguimiento.`
      : "No hay presupuestos pendientes de seguimiento.",
    m.unansweredConversations > 0
      ? `${m.unansweredConversations} conversaciones sin responder — priorizalas.`
      : "Todas las conversaciones están al día.",
  ];

  return { summary, recommendations };
}
