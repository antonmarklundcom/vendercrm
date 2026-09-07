# Phase K2 — The AI setup assistant. OPUS session. Lane 1 of wave K (now wave 2 lane 1, first — PLAN.md §17.2).

Restored 2026-09-06 from PR #93 (§17.0 #1). Read `prompts/_handoff-w2.md` first: branch off latest `main`, rebase before
merge, resolve the append-only conflicts it lists by keeping both sides.

Read ONLY: this file, PLAN.md §16.2 (rules), §16.5 (the steps), §16.6,
`plan-booking.md` §4 and §6.1 (presets are data), `docs/log/k1.md`, then
`src/modules/tenancy/verticals.ts`, `verticals-apply.ts` and its integration
test, `src/app/(app)/onboarding/**`, `src/modules/memory/**`.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the K2 row of PLAN.md §16.6. Plus `docs/log/k2.md`. No new tables
(K1 created `setup_plans`). No edits under `src/modules/automations/**` — flows
are created through the apply function's existing path.

Budget: one session, ≤ 90 min. Branch `phase/k2` off latest main.

Phase rules:
- Preset shape extensions exactly as §16.5, as data + zod in `verticals.ts`;
  `verticals-apply.ts` gains one idempotent-by-name apply step per new field
  (tags, quick replies via the P3 table if merged, else skip with a logged
  reason; widened flow triggers; `staleAfterDays`; `aiMode`; widget copy).
  Extend the apply integration test for each. Never a per-vertical branch.
- `modules/setup/`: `conversation.ts` (the fixed topic sequence of §16.5 step 2;
  each answer is written as confirmed facts through `modules/memory`; skip
  allowed; state stored on the `setup_plans` draft row so a reload resumes),
  `plan.ts` (`generateSetupPlan(ctx)` → one `generateStructured` call with the
  memory as input and the extended preset zod schema as output; prices null
  unless in memory; starts from the closest catalogue preset by
  `vertical_slug`; stores the preset on the draft), `apply.ts` (preview =
  the onboarding preview component fed by the plan; apply =
  `applyVerticalPreset(plan.preset)`, outcome stored, audit written).
- `/onboarding`: the assistant is the default; the rubro picker remains under
  "Elegir un rubro sin el asistente". Re-entry from `/settings/negocio`.
  Superadmin: "Configurar con IA" on the tenant detail runs the same flow
  under impersonation (its guard and banner already exist).
- AI unavailable (`AI_DRIVER=none`) → the assistant explains it and offers
  the picker; nothing throws.
- Tests: plan generation with a mocked driver produces a valid preset; an
  invalid first answer triggers one retry; apply twice leaves no duplicates;
  the conversation resumes from the stored step.

Exit: a tenant with an empty memory can go from first login to an applied plan
(stages, tags, flows, hours) in the integration test with a mocked driver;
`setup_plans` holds preset + outcome; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Do **not** spawn K3: it runs inside wave 2's
lane 2 session (PLAN.md §17.2). Next in this session:
`prompts/opus-p9-voice-notes.md`.
