# Phase W4 — Weekly AI briefing. SONNET session. Wave 2, lane 2, phase 2.

Read ONLY: this file, PLAN.md §15.3 (**L2 — Weekly briefing**, the spec),
§15.5 (J7), §15.10, `plan-booking.md` §4, `docs/log/p7.md` (the Hoy panel and
its ranking), `docs/log/w1.md` (the AI ledger and caps as W1 left them), and
the code you own or call: `src/modules/coach/**`, `src/modules/reports/sales.ts`,
`src/lib/ai/**` (call it, do not change it), `src/modules/whatsapp/send.ts`,
`src/lib/email/**`, `src/worker/**`, `src/app/(app)/dashboard/**`.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the W4 row of PLAN.md §15.10. Plus `docs/log/w4.md`.

Budget: ≤ 90 min. Branch `phase/w4` off latest main. WIP commit every 30 min.

Phase rules:
- Table `coach_briefings` (tenant, week start, numbers json, narrative,
  recommendations json, model, tokens, created_at, delivered_at). One additive
  migration. Unique on (tenant, week start) — a re-run updates, never
  duplicates.
- Job kind `coach.briefing`, scheduled Monday morning **in the tenant's own
  timezone**, not UTC's — K1's follow-up (`d5e3672`) fixed exactly this class
  of bug for promo dates; do not reintroduce it.
- The numbers come from the reports module (`getSalesReport` over the last
  week plus the week before, for the comparison). The AI writes only the
  narrative and three recommendations, in **voseo**, from those numbers —
  it never sees raw tables and never invents a figure. Structured output
  (`generateStructured`) with a zod schema, so a provider that rambles cannot
  land free text in the column.
- Metered by the existing per-tenant AI caps and logged to `ai_replies` like
  every other call. `AI_DRIVER=none` → the numbers card still renders, with no
  narrative and no error.
- Delivery: a card on the dashboard (above or beside the Hoy panel, not
  replacing it), a WhatsApp template to the owner's number, and an email
  through P4's `senderFor(ctx)`. Delivery failures do not lose the row.
- Tests: the week window and the timezone boundary, the structured-output
  contract, a capped tenant skipping cleanly, idempotent re-run, and the
  dashboard card rendering with and without a briefing.

Exit: a Monday `coach.briefing` run for a tenant with data writes one row with
a voseo narrative and three recommendations, renders on the dashboard and
enqueues both deliveries; with `AI_DRIVER=none` nothing throws;
lint/typecheck/test/build green; PR merged; `docs/log/w4.md` + §15.11 line.

## After this phase
Go straight to `prompts/sonnet-w5-reporting.md` in the same session.
