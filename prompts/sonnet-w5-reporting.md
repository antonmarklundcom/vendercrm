# Phase W5 — Reporting v2. SONNET session. Wave 2, lane 2, phase 3.

Read ONLY: this file, PLAN.md §15.5 (J11, reporting half), §15.10,
`plan-booking.md` §4, and the code you own: `src/modules/reports/**`,
`src/app/(app)/reportes/**`, plus `src/modules/crm/**` and
`src/modules/quotes/**` as read-only sources. Do not read the rest.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the W5 row of PLAN.md §15.10. Plus `docs/log/w5.md`.

Budget: ≤ 90 min. Branch `phase/w5` off latest main. WIP commit every 30 min.

Phase rules:
- Build on `getSalesReport`, do not replace it. What v2 adds: a comparison
  window (this period vs the previous one, on every headline number), a
  configurable date range instead of only the preset day counts, per-pipeline
  and per-agent filters, quote-to-deal conversion, average days in each stage,
  and a CSV export of whatever the current filter shows.
- **Aggregate in SQL.** P5 moved the contact list off Node-side filtering for
  exactly this reason; a report that loads rows to count them is not shippable.
  Every new number is a `GROUP BY`, and each one gets a test that asserts the
  count, not just that the query ran.
- Money follows `src/lib/money.ts` — integers in the smallest unit, formatted
  at the edge. No floats in an aggregate, ever.
- Charts stay inside the existing chart components and the existing palette;
  no new charting dependency.
- The CSV export streams and is `requireTenantAdmin()` + `writeAuditLog` (it
  is a bulk data egress).
- Tests: each new aggregate against a seeded fixture with a known answer, the
  comparison window across a month boundary, an empty tenant rendering zeroes
  rather than `NaN`, and the CSV's row count matching the filtered view.

Exit: `/reportes` shows every number with its previous-period comparison,
filters by pipeline, agent and an arbitrary date range, exports that exact set
as CSV, and every aggregate is asserted in tests against a seeded fixture;
lint/typecheck/test/build green; PR merged; `docs/log/w5.md` + §15.11 line.

## After this phase
Go straight to `prompts/sonnet-w6-forms-editor.md` in the same session.
