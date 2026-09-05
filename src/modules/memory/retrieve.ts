import { and, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { businessFacts } from "@/db/schema";
import { escapeLike } from "@/lib/sql-like";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenant } from "@/modules/tenancy/tenants";
import type { BusinessHours, TenantSettings } from "@/modules/tenancy/settings";
import { ALWAYS_KINDS, listFacts, RETRIEVABLE_KINDS, type BusinessFact } from "./facts";
import { isPromoActive, packMemory } from "./pack";
import { getProfile, profileFromLegacyAiSettings } from "./profile";
import {
  estimateTokens,
  formatBusinessHours,
  renderMemoryBlock,
  type MemoryAudience,
  type MemorySelection,
  type RenderableProfile,
} from "./render";

export { isPromoActive, packMemory, type PackInput } from "./pack";

// Retrieval without a vector database (PLAN.md §16.2 rule 4).
//
// Profile, hours and confirmed policies are always in the prompt; FAQs and
// services are picked by `MATCH … AGAINST` against what the customer just
// asked, inside a token budget. MySQL 8's FULLTEXT index is what makes that
// a single indexed query instead of loading every fact and scoring in Node —
// and it is why 0028 creates an index drizzle-kit cannot express.
//
// The internal/confirmed filters are WHERE clauses, not post-filters. A
// post-filter is one forgotten `.filter()` away from putting a tenant's cost
// price in front of a customer; a WHERE clause cannot be forgotten by a
// caller that never writes it.

/** Enough for a profile, the policies and a handful of facts; ~2 KB of prompt. */
export const DEFAULT_BUDGET_TOKENS = 700;
/** How many FAQ/service rows the FULLTEXT query may return before packing. */
export const DEFAULT_TOP_K = 8;

export type BuildMemoryContextOptions = {
  /** What the customer just wrote. Empty means "no query" — recent facts. */
  query?: string | null;
  budgetTokens?: number;
  audience?: MemoryAudience;
  now?: Date;
};

export type MemoryContext = {
  /** The rendered Spanish block, ready to hand to buildSystemPrompt. */
  block: string;
  selection: MemorySelection;
  estimatedTokens: number;
  /** Every fact that made it into the block — the audit answer to "why did it say that?". */
  factIds: string[];
};

export async function buildMemoryContext(
  ctx: TenantContext,
  options: BuildMemoryContextOptions = {},
): Promise<MemoryContext> {
  const audience = options.audience ?? "customer";
  const budgetTokens = options.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const now = options.now ?? new Date();

  const tenant = await getTenant(ctx.tenantId);
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  const [profile, always, promos, matched, internal] = await Promise.all([
    getProfile(ctx),
    listFacts(ctx, { kind: [...ALWAYS_KINDS], ...visibilityFilter(audience) }),
    listFacts(ctx, { kind: "promo", ...visibilityFilter(audience) }),
    searchFacts(ctx, options.query ?? "", audience),
    audience === "internal"
      ? listFacts(ctx, { kind: "note" })
      : Promise.resolve([] as BusinessFact[]),
  ]);

  const legacy = legacyProfile(settings);
  const selection = packMemory({
    audience,
    profile: profile ?? legacy.profile,
    businessName: tenant?.name ?? "",
    hours: resolveHours(always, settings.businessHours) ?? (profile ? null : legacy.hours),
    always,
    candidates: matched,
    promos: promos.filter((promo) => isPromoActive(promo, now, tenant?.timezone ?? undefined)),
    internal,
    budgetTokens,
  });

  const block = renderMemoryBlock(selection);
  return {
    block,
    selection,
    estimatedTokens: estimateTokens(block),
    factIds: [
      ...selection.always,
      ...selection.matched,
      ...selection.promos,
      ...selection.internal,
    ].map((fact) => fact.id),
  };
}

/**
 * The one-release fallback (§16.3 "Migration": "leave the old keys readable
 * for one release"). Only reached when the tenant has no profile row at all
 * — the moment they save /settings/negocio, the row wins and this is dead.
 */
function legacyProfile(settings: TenantSettings): {
  profile: RenderableProfile | null;
  hours: string | null;
} {
  const legacy = profileFromLegacyAiSettings(settings.ai);
  const hasAnything =
    legacy.displayName || legacy.about || legacy.tone || legacy.toneNote || legacy.neverPromise;
  if (!hasAnything) return { profile: null, hours: legacy.hoursFactBody };
  return {
    profile: {
      displayName: legacy.displayName,
      about: legacy.about,
      audience: null,
      differentiators: null,
      tone: legacy.tone,
      toneNote: legacy.toneNote,
      address: null,
      mapsUrl: null,
      website: null,
      paymentMethods: null,
      neverPromise: legacy.neverPromise,
    },
    hours: legacy.hoursFactBody,
  };
}

/**
 * A customer-facing prompt sees confirmed, customer-visible facts and
 * nothing else. The setup assistant's brief (audience "internal") sees
 * everything, including what the AI has suggested but nobody has confirmed —
 * that is the point of the brief.
 */
function visibilityFilter(audience: MemoryAudience) {
  return audience === "customer"
    ? { visibility: "customer" as const, confirmedOnly: true }
    : {};
}

/**
 * The free-text "Horario" fact wins over the structured week, because a
 * business that wrote a sentence ("de 8 a 17, sábados hasta el mediodía, y
 * feriados cerramos") said something the seven-row form cannot.
 */
function resolveHours(always: BusinessFact[], businessHours: BusinessHours | undefined): string | null {
  const fact = always.find(
    (row) => row.kind === "location" && row.title.trim().toLowerCase() === "horario",
  );
  if (fact?.body) return fact.body;
  return formatBusinessHours(businessHours);
}

/**
 * Top-k FAQs and services for a question.
 *
 * Natural-language mode rather than boolean: the input is a customer's
 * sentence, not a query language, and boolean mode would treat a stray `-`
 * or `+` in "¿cuánto sale el corte + barba?" as an operator. Falls back to a
 * LIKE scan when FULLTEXT is unavailable (a MySQL without the index, or a
 * query of nothing but stopwords) so a missing index degrades the answer
 * instead of breaking the reply.
 */
export async function searchFacts(
  ctx: TenantContext,
  query: string,
  audience: MemoryAudience,
  limit = DEFAULT_TOP_K,
): Promise<BusinessFact[]> {
  const trimmed = query.trim().slice(0, 500);
  const base = kindAndVisibility(audience);

  if (trimmed.length < 2) {
    return tenantDb(ctx)
      .select(businessFacts, base)
      .orderBy(desc(businessFacts.updatedAt))
      .limit(limit);
  }

  try {
    const rows = await tenantDb(ctx)
      .select(
        businessFacts,
        and(
          base,
          sql`MATCH (${businessFacts.title}, ${businessFacts.body}) AGAINST (${trimmed} IN NATURAL LANGUAGE MODE)`,
        ) as SQL,
      )
      .orderBy(
        desc(
          sql`MATCH (${businessFacts.title}, ${businessFacts.body}) AGAINST (${trimmed} IN NATURAL LANGUAGE MODE)`,
        ),
        // Ties broken by id so two runs of the same query build the same
        // prompt — the tests depend on it, and so does reading a diff of two
        // stored prompts.
        businessFacts.id,
      )
      .limit(limit);
    if (rows.length > 0) return rows;
  } catch {
    // No FULLTEXT index (a database migrated by hand, or MyISAM): fall
    // through to LIKE rather than failing the reply.
  }

  return likeFallback(ctx, trimmed, base, limit);
}

function kindAndVisibility(audience: MemoryAudience): SQL {
  const clauses: SQL[] = [inArray(businessFacts.kind, [...RETRIEVABLE_KINDS])];
  if (audience === "customer") {
    clauses.push(eq(businessFacts.visibility, "customer"));
    clauses.push(isNotNull(businessFacts.confirmedAt));
  }
  return and(...clauses) as SQL;
}

async function likeFallback(
  ctx: TenantContext,
  query: string,
  base: SQL,
  limit: number,
): Promise<BusinessFact[]> {
  // The longest words carry the meaning; "cuánto" and "el" match everything.
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  if (words.length === 0) {
    return tenantDb(ctx).select(businessFacts, base).orderBy(businessFacts.id).limit(limit);
  }

  const like = words.map(
    (word) =>
      sql`(lower(${businessFacts.title}) like ${`%${escapeLike(word)}%`} or lower(coalesce(${businessFacts.body}, '')) like ${`%${escapeLike(word)}%`})`,
  );
  return tenantDb(ctx)
    .select(businessFacts, and(base, sql`(${sql.join(like, sql` or `)})`) as SQL)
    .orderBy(businessFacts.id)
    .limit(limit);
}
