# Phase P15 — Reporting v2 (J11a). SONNET session. Wave 2 lane 2.

Read ONLY: this file, PLAN.md §17.3 "P15 / P17" (P15 half), §17.2 (P15 row),
§10 1J #1 (export = what is on screen), `prompts/_handoff-w2.md`,
`plan-booking.md` §4, then `src/modules/reports/**`, `src/app/(app)/reports/**`,
`src/app/api/exports/**` (the contacts export route as the pattern),
`src/modules/crm/contact-list.ts` (query-param → SQL pattern),
`src/db/schema/campaigns.ts` if it exists on `main`.

Owns: the P15 row of §17.2. Plus `docs/log/p15.md`.
Hard limits: no schema; reads only; computation stays in pure functions over
rows the way `sales.ts` already works.

Budget: one session, ≤ 90 min. Branch `phase/p15` off latest main.

Phase rules:
- `reports/sales.ts` grows: per-agent table (leads, deals opened, won, lost,
  won value, median first-response time), per-source and per-site table,
  stage-by-stage conversion for one pipeline, response-time distribution,
  and a `previous` window computed with the same function for the
  comparison column. If `campaign_recipients` exists on `main`, a campaigns
  table (sent/delivered/read/replied per campaign); otherwise omit and log.
- `/reports`: date-range picker (presets 7/30/90 days + custom, tenant tz),
  pipeline picker, agent filter; every table sortable; the comparison column
  with a delta. All params in the URL (§10 1R #1 rule).
- `/api/exports/reports/[table]` CSV through the exact same query path as
  the page, session-guarded, rate-limited like the contacts export.
- Tests: pure cases per new computation (`sales.test.ts` pattern) including
  an empty window and a window straddling a month boundary; one integration
  case asserting page and export return the same rows for the same URL.

Exit: the page renders every table with a comparison column for a seeded
tenant; CSV matches the page; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Next in this session: `prompts/sonnet-p16-companies-merge.md`.
