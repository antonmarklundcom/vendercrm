import { inArray, or, sql, type SQL } from "drizzle-orm";
import { contacts, conversations, deals, documents, quotes } from "@/db/schema";
import { formatMoney } from "@/lib/i18n/format";
import { escapeLike } from "@/lib/sql-like";
import { normalizePhone, type CountryCode } from "@/lib/phone";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Cross-entity search behind the ⌘K palette (PLAN.md §13 H8). Everything
// goes through tenantDb, so a result set can only ever contain the caller's
// own tenant — the palette is the one place in the product that reads across
// five tables at once, which makes that scoping the whole security story.
//
// The other constraint is volume: this runs on every keystroke the debounce
// lets through, so every query below is bounded in SQL. Fetching a whole
// table and slicing in JS is affordable on a page load and not here — see
// PER_KIND and the conversations lookup.
//
// contacts.name/email, deals.title and quotes/documents.number are matched
// with MySQL FULLTEXT (migration 0028) instead of `LIKE '%term%'` — a
// leading wildcard can never use an index, so LIKE forced a full table scan
// on every keystroke as a tenant's rows grew.
//
// BOOLEAN MODE, not NATURAL LANGUAGE MODE — found the hard way. InnoDB's
// natural-language relevance ranking silently drops any word present in
// more than 50% of a table's rows (treats it as a de facto stopword,
// MATCH...AGAINST returns 0 for every row). That's fine for prose, but
// quotes.number/documents.number are per-*tenant* sequences that all start
// at the same value ("COT-000001", "NV-000001", ...) in one shared, un-
// partitioned table — so once enough tenants exist, "000001" is a top hit
// table-wide and natural language mode stops matching it for *any* tenant,
// tenant scoping notwithstanding. Boolean mode has no such threshold, so it
// was used for all four columns rather than mixing modes.
//
// Trade-offs that come with FULLTEXT generally, intentionally accepted:
//   - InnoDB drops tokens under innodb_ft_min_token_size (3 by default) —
//     the query below filters those out itself so a lone short word can't
//     produce an ANDed condition that can never match anything.
//   - Tokenization splits on non-alphanumeric characters, so "COT-000123"
//     indexes as "COT" (usually dropped, too short) and "000123" (the
//     6-digit zero-padded sequence keeps this at/above the token floor).
//   - Each surviving word is right-truncated (`word*`) so "Villa" still
//     finds "Villalba" and "COT-0001" still finds "COT-000123", but a 1-2
//     character fragment no longer matches the way LIKE's substring scan
//     did — the ⌘K palette is for jumping to a known record by name or
//     number, not for browsing arbitrary substrings. Multiple words are OR
//     rather than AND (no `+` requiring every word) — boolean mode still
//     enforces InnoDB's default stopword list even without the natural-
//     language relevance ranking, and AND-of-required-words means a query
//     landing on even one stopword (a contact's email at a `.com` domain
//     is enough: "com" is a default InnoDB stopword) makes the whole
//     multi-word query unmatchable. OR degrades to "matches on at least
//     one word" instead, which is the same direction LIKE already failed
//     in for multi-word queries (it required an exact contiguous
//     substring), so this isn't a new class of surprise.
//   - InnoDB flushes newly written rows into a FULLTEXT index from an
//     in-memory cache rather than synchronously at commit — observed in
//     testing to occasionally take a few seconds under light write load.
//     LIKE never had this gap. A record created and searched for in the
//     same instant may not appear in the palette immediately; it does once
//     the index catches up, with nothing for the app to do about it (no
//     public knob forces a synchronous flush short of `OPTIMIZE TABLE`,
//     which rebuilds the whole table and is not something to run per
//     write). Search test assertions below poll rather than asserting
//     once, for exactly this reason.

export type SearchKind = "contact" | "deal" | "quote" | "document" | "conversation";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

export type SearchResults = {
  query: string;
  hits: SearchHit[];
};

const PER_KIND = 5;

/** Digits-only view of the query, so "0981 123 456", "981123456" and
 * "+595981123456" all find the same contact. */
function phoneVariants(query: string, country: CountryCode | undefined): string[] {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 4) return [];

  const variants = new Set<string>([digits]);
  try {
    if (country) variants.add(normalizePhone(query, country).replace(/\D/g, ""));
  } catch {
    // Not phone-shaped; the name/email match still applies.
  }
  return [...variants];
}

// MySQL boolean-mode operators (+ - < > ( ) ~ * " @) mean something other
// than the literal character to AGAINST() — an unescaped stray one can
// throw a syntax error or silently change what matches, the same reason
// escapeLike exists for LIKE. Splitting on them (rather than backslash-
// escaping, which boolean mode doesn't reliably honor for all of them)
// keeps a rep's punctuation from ever being read as a query operator.
//
// Each surviving word is right-truncated (`*`, prefix match) and OR'd
// together — see the module comment for why prefix-OR instead of natural
// language mode or an AND of required words. Words under the FULLTEXT
// token floor are dropped entirely rather than left in as a clause that
// can never match anything (a wildcard on a too-short prefix still
// matches nothing, since no indexed token is that short either).
const MIN_FULLTEXT_TOKEN_LENGTH = 3;

function toBooleanFulltextQuery(query: string): string | null {
  // Split on the same boundary FULLTEXT itself uses — any non-alphanumeric
  // run, not just whitespace — so "fernanda@example.com" and "COT-000123"
  // become the same word list AGAINST() will see on the indexed side
  // ("fernanda"/"example"/"com", "COT"/"000123"), rather than leaving a
  // punctuation-joined chunk like "example.com" that no indexed token
  // actually equals.
  const tokens = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_FULLTEXT_TOKEN_LENGTH);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}*`).join(" ");
}

export async function searchTenant(
  ctx: TenantContext,
  rawQuery: string,
  defaultCountry?: CountryCode,
  locale = "es",
): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (query.length < 2) return { query, hits: [] };

  const db = tenantDb(ctx);
  const booleanQuery = toBooleanFulltextQuery(query);

  const phoneMatches = phoneVariants(query, defaultCountry).map(
    // Compare digits to digits: stored phones are E.164, the typed query
    // rarely is. Phone stays on LIKE — it's matched as a normalized digit
    // string, not free text, so FULLTEXT tokenization buys nothing here.
    (digits) =>
      sql`replace(replace(replace(${contacts.phone}, '+', ''), '-', ''), ' ', '') like ${`%${escapeLike(digits)}%`}`,
  );

  const contactConditions: SQL[] = [
    ...(booleanQuery
      ? [
          sql`match(${contacts.name}, ${contacts.email}) against(${booleanQuery} in boolean mode)`,
        ]
      : []),
    ...phoneMatches,
  ];
  const dealCondition = booleanQuery
    ? sql`match(${deals.title}) against(${booleanQuery} in boolean mode)`
    : null;
  const quoteCondition = booleanQuery
    ? sql`match(${quotes.number}) against(${booleanQuery} in boolean mode)`
    : null;
  const documentCondition = booleanQuery
    ? sql`match(${documents.number}) against(${booleanQuery} in boolean mode)`
    : null;

  // No condition at all (e.g. the whole query was too-short words) means no
  // table can match — skip the round trip rather than let an empty/absent
  // WHERE clause fall through to "every row in the tenant".
  const [contactRows, dealRows, quoteRows, documentRows] = await Promise.all([
    contactConditions.length
      ? db.select(contacts, or(...contactConditions)).limit(PER_KIND)
      : Promise.resolve([]),
    dealCondition ? db.select(deals, dealCondition).limit(PER_KIND) : Promise.resolve([]),
    quoteCondition ? db.select(quotes, quoteCondition).limit(PER_KIND) : Promise.resolve([]),
    documentCondition
      ? db.select(documents, documentCondition).limit(PER_KIND)
      : Promise.resolve([]),
  ]);

  // Conversations carry no text of their own; they are reached by the
  // contact behind them, which is how a rep thinks about them anyway. That
  // makes them a lookup *by the contacts already matched* — previously this
  // read every conversation row the tenant owned, on every keystroke, to
  // then throw nearly all of them away.
  const contactById = new Map(contactRows.map((row) => [row.id, row]));
  const conversationRows = contactById.size
    ? await db
        .select(conversations, inArray(conversations.contactId, [...contactById.keys()]))
        .limit(PER_KIND)
    : [];

  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);

  const hits: SearchHit[] = [
    ...contactRows.map((row) => ({
      kind: "contact" as const,
      id: row.id,
      title: row.name,
      subtitle: row.phone,
      href: `/contacts/${row.id}`,
    })),
    ...dealRows.map((row) => ({
      kind: "deal" as const,
      id: row.id,
      title: row.title,
      // Money goes through the same formatter as every other screen (§13
      // H5 #5) — the palette used to print raw minor units, so a deal worth
      // 1.500.000 PYG read as "1500000 PYG" here and correctly everywhere else.
      subtitle: money(row.value, row.currency),
      href: `/pipeline/${row.id}`,
    })),
    ...quoteRows.map((row) => ({
      kind: "quote" as const,
      id: row.id,
      title: row.number,
      subtitle: money(row.total, row.currency),
      href: `/quotes/${row.id}`,
    })),
    ...documentRows.map((row) => ({
      kind: "document" as const,
      id: row.id,
      title: row.number,
      subtitle: money(row.total, row.currency),
      href: `/documents/${row.id}`,
    })),
    ...conversationRows.flatMap((row) => {
      const contact = contactById.get(row.contactId);
      if (!contact) return [];
      return [
        {
          kind: "conversation" as const,
          id: row.id,
          title: contact.name,
          subtitle: contact.phone,
          href: `/inbox/${row.id}`,
        },
      ];
    }),
  ];

  return { query, hits };
}
