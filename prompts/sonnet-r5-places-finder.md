# Phase R5 — Google Places finder, website enrichment, retention. SONNET 5.5 session (medium effort).

Read first:
- `PLAN-PROSPECTING.md` §1, §4.2 (R5 tables), §8 and §10.
- `docs/log/r2.md`–`r4.md`.
- `src/modules/prospecting/**` (dedupe, profiles, ai jobs).
- `src/lib/rate-limit/index.ts`, `src/lib/config/env.ts`.
- `src/modules/coach/jobs.ts` + `src/worker/maintenance.ts` (chain pattern).
- `src/app/(marketing)/` (for the public `/bot` page).

Branch: `phase/r5-places` off the latest `main`. One PR. Log in `docs/log/r5.md`.

## Hard rules
- **Places API (New) Text Search only**, via REST with an explicit field mask (plan §8.1). No scraping of Google Maps HTML.
  - Verify the endpoint, field names and SKU in the current docs (developers.google.com/maps/documentation/places/web-service/text-search) before writing the client. Don't guess.
  - Recheck the pricing page, and update plan §8.1 if it changed.
- **Cost guard:**
  - An estimate before every run.
  - A monthly request cap (default 900) enforced server-side; a run that would cross it is refused.
  - `places_runs` records the requests used.
- **Tests:** mock `fetch`; no real Google calls. `GOOGLE_PLACES_API_KEY` is optional in `env.ts`; without it the finder UI explains the setup and nothing crashes.
- **Website fetcher:**
  - robots.txt respected, 1 request per 5 s per host, 10 s timeout, 1 MB cap, HTML only, same-site redirects only.
  - User agent `VenderCRMBot/1.0 (+https://clientes.com.py/bot)`, plus the public `/bot` page.
  - The extractor is pure, with HTML fixtures.
- **Retention job** exactly as plan §8.4, with the "Datos de Google Maps" attribution in the UI.
- **DNC / suppressions** respected at ingest.
- **Tables:** one migration, tenant-scoped, isolation tests.
- **i18n:** es/en/sv, parity green.
- **No new GitHub workflow.**

## Exit
Everything in plan §8.6:
- Gates green.
- If Anton has set a key: one real run with max 1 page, reporting the requests used and the results. Otherwise say so plainly.
- The browser at 375 px showing Nuevos with the new prospects and the attribution.
- `docs/log/r5.md`.
- PR merged.

Then **stop and report to Anton**. Do not start R6. Spawn nothing. Never Fable.
