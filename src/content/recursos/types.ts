import type { MarketingVertical } from "@/app/(marketing)/soluciones/verticals";

// The /recursos content hub (MARKETING_SITE_PLAN.md §7, phase M2). Static
// file-based content by locked decision — no DB-backed CMS, Drizzle stays a
// CRM concern.
//
// Article *bodies* live here rather than in messages/*.json on purpose. The
// UI chrome around them is translated (en/sv key parity is enforced by
// src/i18n/messages.test.ts); the articles themselves are Paraguayan Spanish
// and only Spanish — they are written for people searching in Spanish on
// google.com.py, and a machine-shaped English copy of each would be dead
// weight in the bundle and in the sitemap.

export type ArticleBlock =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  /** A worked example: the arithmetic a reader can redo with their own
   * numbers. Never a market statistic — nothing here is sourced from a study
   * this site cannot cite. */
  | { kind: "math"; title: string; rows: Array<{ label: string; value: string }>; note: string }
  | { kind: "callout"; text: string };

export type Article = {
  slug: string;
  /** The vertical page this article funnels to. One cluster per vertical. */
  vertical: MarketingVertical;
  /** H1. Never a phrase the vertical page itself targets (§7). */
  title: string;
  /** <title>, which may be longer and carry the qualifier. */
  metaTitle: string;
  description: string;
  eyebrow: string;
  lead: string;
  /** ISO date, shown to the reader and used for `dateModified`. */
  updated: string;
  readingMinutes: number;
  body: ArticleBlock[];
  /** 2–3 siblings, by slug. Checked at build time by the index module. */
  related: string[];
  /** Prefilled WhatsApp text, so a conversation names the article it began in. */
  waPrefill: string;
};
