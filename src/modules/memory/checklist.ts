import type { TenantAiSettings } from "@/modules/tenancy/settings";
import type { BusinessFact } from "./facts";
import type { BusinessProfile } from "./profile";

// The pure profile logic (PLAN.md §16.3–§16.4): what "complete" means, and
// what migration 0028 copies out of `settings.ai`. Split from profile.ts so
// both can be unit tested with no database, the way modules/booking/slots.ts
// separates the slot rules from the queries that feed them.

export const TONES = ["cercano", "formal", "directo"] as const;
export type Tone = (typeof TONES)[number];

/**
 * The checklist the memory page and the coach both read (§16.4). Pure: it is
 * the definition of "complete", so it is tested directly and cached into
 * `completed_pct` rather than recomputed in two places that could disagree.
 */
export type ChecklistKey =
  | "hours"
  | "address"
  | "about"
  | "faqs"
  | "cancellation"
  | "payment"
  | "tone"
  | "neverPromise";

export type ChecklistRow = { key: ChecklistKey; done: boolean };

export type ChecklistInput = {
  profile: Pick<
    BusinessProfile,
    "about" | "address" | "tone" | "toneNote" | "neverPromise" | "paymentMethods"
  > | null;
  facts: Pick<BusinessFact, "kind" | "title" | "structured" | "visibility">[];
  /** The structured `settings.businessHours`, which also satisfies the row. */
  hasBusinessHours: boolean;
};

/** How many FAQs count as "the customer questions are written down". */
export const FAQ_TARGET = 3;

export function memoryChecklist(input: ChecklistInput): ChecklistRow[] {
  const { profile, facts } = input;
  const customerFacts = facts.filter((fact) => fact.visibility === "customer");
  const faqs = customerFacts.filter((fact) => fact.kind === "faq").length;
  const hasHoursFact = customerFacts.some(
    (fact) => fact.kind === "location" && fact.title.trim().toLowerCase() === "horario",
  );
  const hasCancellation = customerFacts.some(
    (fact) =>
      fact.kind === "policy" &&
      (fact.structured as { topic?: string } | null)?.topic === "cancellation",
  );

  return [
    { key: "hours", done: input.hasBusinessHours || hasHoursFact },
    { key: "address", done: !!profile?.address },
    { key: "about", done: !!profile?.about },
    { key: "faqs", done: faqs >= FAQ_TARGET },
    { key: "cancellation", done: hasCancellation },
    {
      key: "payment",
      done: (profile?.paymentMethods ?? []).length > 0,
    },
    { key: "tone", done: !!profile?.tone || !!profile?.toneNote },
    { key: "neverPromise", done: !!profile?.neverPromise },
  ];
}

export function completedPct(input: ChecklistInput): number {
  const rows = memoryChecklist(input);
  const done = rows.filter((row) => row.done).length;
  return Math.round((done / rows.length) * 100);
}

/**
 * The one-release fallback for a tenant whose profile row does not exist yet
 * (§16.3 "leave the old keys readable for one release"). The 0028 migration
 * copies the same five fields in SQL; this is what a tenant created *between*
 * the migration and their first visit to /settings/negocio reads, and it is
 * the testable statement of what that SQL does.
 */
export function profileFromLegacyAiSettings(
  ai: TenantAiSettings | undefined,
): Pick<BusinessProfile, "displayName" | "about" | "tone" | "toneNote" | "neverPromise"> & {
  hoursFactBody: string | null;
} {
  const tone = (ai?.tone ?? "").trim();
  return {
    displayName: nullIfBlank(ai?.businessName),
    about: nullIfBlank(ai?.about),
    tone: (TONES as readonly string[]).includes(tone.toLowerCase())
      ? (tone.toLowerCase() as Tone)
      : null,
    toneNote: nullIfBlank(ai?.tone),
    neverPromise: nullIfBlank(ai?.neverPromise),
    hoursFactBody: nullIfBlank(ai?.hours),
  };
}

function nullIfBlank(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
