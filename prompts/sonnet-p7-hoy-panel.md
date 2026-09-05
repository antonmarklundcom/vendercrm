# Phase P7 — The "Hoy" panel (coach level 1). SONNET session. Lane 2, parallel.

Read ONLY: this file, PLAN.md §15.3 (L1 only), §15.5 (J6), §15.8,
`plan-booking.md` §4, `docs/log/p1.md`, `docs/log/p2.md`, then
`src/modules/dashboard/summary.ts`, `src/app/(app)/dashboard/**`, the read
functions in crm/tasks.ts, crm/deals.ts, whatsapp/inbox.ts, quotes/quotes.ts,
booking/bookings.ts you will call.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the P7 row of PLAN.md §15.8. Plus `docs/log/p7.md`.
Hard limits: read-only over other modules (call their exported list functions;
add a small exported query to a module only if none exists, one function, no
schema); no AI calls in this phase.

Budget: one session, ≤ 90 min. Branch `phase/p7` off latest main.

Phase rules:
- `modules/coach/hoy.ts`: `buildHoy(ctx, now)` returns ranked items
  `{kind, severity, title, subtitle, url, action}` from: conversations with
  `unreadCount > 0` and last inbound older than 60 min inside business hours;
  deals whose `stageEnteredAt` exceeds `stages.stale_after_days` (P5 adds the
  column; fall back to 7 days when null); quotes `sent` 3+ days with no
  activity since and no open task; leads (lead_submissions) in the last 48 h
  whose contact has no deal; confirmed bookings in the next 24 h with no
  delivered reminder row; overdue tasks. Ranking rules in one pure function
  with unit tests; a per-user variant (`mine`) filters by assignment.
- Dashboard: the panel at the top, per-item action buttons that deep-link
  (open thread, deal, quote, booking, task) — no new mutations here.
- Morning push: a daily job `coach.morning` (tenant timezone 08:00) enqueues
  P2's `push.send` with the count and top three titles to each user who has a
  subscription; if P2's queue helper is absent, write the `notifications` row
  only. No WhatsApp send in this phase (template approval is a human step).
- All strings via next-intl; tests beside the module.

Exit: `buildHoy` unit tests cover each rule and the ranking; dashboard renders
the panel with an empty-state; morning job enqueues per user; lint/typecheck/
test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md`. Spawn nothing.
