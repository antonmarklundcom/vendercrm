import type { BusinessFact } from "./facts";
import {
  estimateTokens,
  renderFact,
  renderMemoryBlock,
  type MemoryAudience,
  type MemorySelection,
  type RenderableProfile,
} from "./render";

// The pure half of retrieval (PLAN.md §16.4): which facts fit in the prompt,
// and which promos are still true today. Split from retrieve.ts so it can be
// tested without a database — the budget order *is* the spec, and a spec
// that can only be exercised against live MySQL does not get exercised.

/** Promos are only true between their dates; an expired one is noise. */
export function isPromoActive(fact: BusinessFact, now: Date): boolean {
  const structured = (fact.structured ?? {}) as { validFrom?: unknown; validUntil?: unknown };
  const today = now.toISOString().slice(0, 10);
  if (typeof structured.validFrom === "string" && today < structured.validFrom) return false;
  if (typeof structured.validUntil === "string" && today > structured.validUntil) return false;
  return true;
}

export type PackInput = {
  audience: MemoryAudience;
  profile: RenderableProfile | null;
  businessName: string;
  hours: string | null;
  always: BusinessFact[];
  /** Ranked best-first; the packer takes them in order until the budget runs out. */
  candidates: BusinessFact[];
  promos: BusinessFact[];
  internal: BusinessFact[];
  budgetTokens: number;
};

/**
 * Fits the memory into the budget. Pure, and the priority order *is* the
 * spec (§16.4): the profile, hours and the always-facts go in whatever the
 * budget says — a reply that forgets the cancellation policy to fit one more
 * FAQ is worse than a long prompt — and the retrieved facts, then the
 * promos, then internal notes fill what is left, best-first, stopping at the
 * first one that does not fit.
 */
export function packMemory(input: PackInput): MemorySelection {
  const selection: MemorySelection = {
    audience: input.audience,
    profile: input.profile,
    businessName: input.businessName,
    hours: input.hours,
    always: input.always,
    matched: [],
    promos: [],
    internal: [],
    truncated: false,
  };

  let used = estimateTokens(renderMemoryBlock(selection));

  const fill = (source: BusinessFact[], target: BusinessFact[]) => {
    for (const fact of source) {
      // +1 for the "- " and the newline the section adds around the fact.
      const cost = estimateTokens(renderFact(fact)) + 1;
      if (used + cost > input.budgetTokens) {
        selection.truncated = true;
        return;
      }
      target.push(fact);
      used += cost;
    }
  };

  fill(input.candidates, selection.matched);
  fill(input.promos, selection.promos);
  if (input.audience === "internal") fill(input.internal, selection.internal);

  return selection;
}
