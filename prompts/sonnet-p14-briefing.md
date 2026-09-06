# Phase P14 — Weekly AI briefing (J7). SONNET session. Wave 2 lane 2.

Read ONLY: this file, PLAN.md §15.3 (L2), §17.3 "P14", §17.5 (the audit row
J8's trigger needs), §17.2 (P14 row), `prompts/_handoff-w2.md`,
`plan-booking.md` §4, `docs/log/p7.md` (the hourly-chain pattern and its
decision 1), `docs/log/k1.md` (`generateStructured`, the ledger kinds), then
`src/modules/coach/**`, `src/modules/reports/sales.ts`, `src/lib/ai/index.ts`
+ `structured.ts`, `src/modules/ai/replies.ts` (ledger write + caps),
`src/modules/memory/profile.ts`, `src/lib/email/index.ts`,
`src/modules/notifications/index.ts`, `src/modules/whatsapp/templates.ts`
(`listApprovedTemplates`), `src/app/(app)/dashboard/**`.

Owns: the P14 row of §17.2. Plus `docs/log/p14.md`.
Hard limits: no change to `coach/rank.ts` rules (K3 adds rows there); no new
AI driver methods; no WhatsApp free-text send.

Budget: one session, ≤ 90 min. Branch `phase/p14` off latest main.

Phase rules:
- Schema `src/db/schema/coach.ts`: `coach_briefings` (tenant, week_start
  date, metrics json, narrative text, recommendations json, source
  `ai | template`, ai_reply_id?, created_at; unique (tenant, week_start)).
  `ai_replies.kind` +`weekly_briefing`. One migration.
- `coach/briefing.ts`: `buildBriefingInput(ctx, weekStart)` = `getSalesReport`
  for the week and the one before, Hoy counts by kind, the business profile
  (name, tone). `narrative.ts` (pure): `templateNarrative(input)` — the
  deterministic Spanish voseo text every tenant gets — and
  `verifyNarrative(text, input)` — every number in the text must appear in
  the input's number set and every cited metric key must exist. `generate`
  tries `generateStructured` with zod `{summary, recommendations: 3 strings,
  citedMetrics: string[]}` when AI is configured and the daily cap allows,
  runs `verifyNarrative`, and on any failure stores the template narrative
  with `source: template`. Ledger row on every provider call.
- `briefing-jobs.ts`: `coach.weekly`, hourly self-rescheduling like
  `coach.morning`, acts on tenants whose local clock reads Monday 07:xx; the
  unique index makes a re-run a no-op. Registered in the worker.
- Delivery: dashboard card (latest briefing, link to `/dashboard/briefings/[id]`
  and a list), one `notifications` row per admin (P2 push carries it),
  email to admins via `sendEmail` (`kind: transactional`); WhatsApp only if
  the tenant's approved templates contain `briefing_semanal`, via
  `sendTemplate` to the tenant's contact-number conversation if one exists,
  else skipped with a reason in the log row.
- Instrumentation for §17.5: the Hoy panel's action buttons and the morning
  push URL go through a tiny server action that writes `audit_log`
  `coach.hoy_action` (kind, severity, origin `panel | push`) and redirects.
- Tests: `narrative.test.ts` (template output, verifier accept/reject,
  invented number rejected); `briefing.test.ts` with a mocked driver (AI
  path, invalid output → template fallback, cap hit → template, AI off →
  template); integration: the weekly job writes one row per tenant per week
  and a second run writes nothing.

Exit: a tenant with AI off gets a Monday briefing with correct numbers; a
tenant with a mocked AI gets the model's prose only when it cites real
numbers; the dashboard shows it; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Next in this session: `prompts/sonnet-p15-reporting.md`.
