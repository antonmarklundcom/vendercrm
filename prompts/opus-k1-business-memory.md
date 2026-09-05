# Phase K1 — Business memory. OPUS session. ✅ Built in PR #94 (2026-09-05); kept for re-runs only.

Read ONLY: this file, PLAN.md §16.1–§16.4, §16.6 table, §10 1O (AI auto-reply),
`plan-booking.md` §4 (autonomy protocol), `docs/HANDOFF.md` Part 2A conventions,
then `src/lib/ai/**`, `src/modules/ai/**`, `src/modules/chatwidget/reply.ts`,
`src/modules/tenancy/settings.ts`. Do not read the rest.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the K1 row of PLAN.md §16.6. Plus `docs/log/k1.md`. Do not edit
`src/app/(app)/settings/page.tsx` (the P-wave owns it); your UI is the new route
`/settings/negocio`; the link pass adds the nav entry.

Budget: one session, ≤ 90 min. Branch `phase/k1` off latest main. WIP commit
every 30 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Schema exactly as §16.3 (`business_profiles`, `business_facts` with the
  FULLTEXT index, `memory_imports`, `setup_plans` — create all four now so K2/K3
  add no migrations). Migration copies the five `settings.ai` text fields per
  §16.3; keep the old keys readable this release.
- `modules/memory/`: `profile.ts` (get/upsert, `completedPct`), `facts.ts`
  (CRUD, confirm, list by kind, `visibility` enforced at query level),
  `retrieve.ts` (`buildMemoryContext(ctx, {query, budgetTokens, audience:
  "customer" | "internal"})` — always profile + hours + confirmed policies;
  top-k FAQs/services by `MATCH … AGAINST` on the query; promos in date; rough
  token estimate = chars/4; deterministic order for tests), `render.ts` (the
  Spanish prompt block, voseo).
- `lib/ai`: add `generateStructured(input, {schema: zod, maxOutputTokens})` to
  the driver interface with JSON mode on OpenAI (`response_format`) and
  Gemini (`responseSchema`/JSON mime); zod-validate; one retry with the
  validation error appended; ledger `kind` values `memory_extract`,
  `setup_plan`. `buildSystemPrompt` takes the rendered memory block instead of
  the five fields; `resolveAiConfig.business` is built from the profile.
- `/settings/negocio`: profile form, facts grouped by kind with add/edit/
  confirm/delete, a completion checklist (hours, address, 3+ FAQs,
  cancellation policy, payment methods, tone, never-promise), internal facts
  visibly marked. Admin only; audit on confirm/edit/delete.
- Tests: retrieval picks the matching FAQ and excludes internal facts;
  budget truncation; migration copy; structured generation validates and
  retries (driver mocked).
- Re-runnable; minor issues → docs/log/k1.md; stop only per protocol §4.4.

Exit: an AI reply integration test answers a "¿cuánto cuesta X?" with the
confirmed service fact and never with an internal note; `/settings/negocio`
round-trips every kind; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md` (same gates). Next: `prompts/opus-k2-setup-assistant.md`, model Opus.
