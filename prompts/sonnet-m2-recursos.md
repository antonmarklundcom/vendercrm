# Phase M2 — clientes.com.py /recursos content hub. Paste into a fresh SONNET session, ONLY after phase M1 is merged.

Read `docs/MARKETING_NEXT_STEPS.md` FIRST (its §8 build log tells you where M1 left
things), then `docs/MARKETING_SITE_PLAN.md` §2 and §7 (content strategy) and
`docs/MARKETING_DESIGN.md`. Execute MARKETING_NEXT_STEPS §3.4 under its §7 autonomy
rules.

HARD LIMITS (Sonnet phase — no foundation changes):
- No changes to `src/middleware.ts`, auth, the database schema, or ANY code under the
  CRM surface (`(app)`, `(superadmin)`, `(auth)`, `api` except nothing at all).
- No new runtime dependencies beyond what MDX rendering itself needs; static
  file-based content only — no DB-backed CMS (locked decision).
- Marketing design system as-is: `.mk` tokens and existing components; if something
  needs a new pattern, work around it and add a Backlog note — don't invent one.

Phase rules:
- Branch `phase/m2-recursos` off latest main. M1 unmerged ⇒ finish that first.
- Load skills: `seo-web-builds` (every article: one intent, titles/metas, Article
  JSON-LD, internal links), `web-design-system` (article layout + QA gate). A missing
  skill is never a stopper: nearest equivalent + build-log note.
- Content: one cluster per vertical per MARKETING_SITE_PLAN §7 — start with 2 articles
  per vertical (10 total), Paraguayan Spanish voseo, practical and numeric, no
  fabricated statistics (cite nothing you can't source; write from reasoning instead).
  Every article links its vertical page + 2–3 siblings; never target a keyword a
  vertical page owns.
- `/recursos` index + `/recursos/[slug]`, added to sitemap; UI chrome strings through
  `messages/*.json` with en/sv key parity (`src/i18n/messages.test.ts` enforces).
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; validate before every push:
  `npm run lint && npm run typecheck`, `npx vitest run src/middleware.test.ts
  src/i18n/messages.test.ts`, `npm run build`.

Exit: /recursos live with the 10 articles, sitemap and internal links in place, CI
green, PR merged, build-log entry appended to MARKETING_NEXT_STEPS §8.

## After this phase — STOP and report
This is the last planned phase. Verify the merge through the GitHub MCP tools, then
end with a closing report to Anton: live URLs, what shipped in M1+M2, the §2 items
still waiting on his input (if any), and the §5 CRM backlog reminder — those ideas
remain advisory and need his explicit go-ahead before anyone builds them. Do not
spawn further sessions.
