# Wave 2 lane 1 — K2, P9, P10, P11, one Opus session, end to end

You are the single Opus session for wave 2's lane 1 (PLAN.md §17.2). Four
phases, all yours, in this order, one PR each, each merged before the next
starts:

| # | Prompt | Builds |
|---|---|---|
| 1 | `prompts/opus-k2-setup-assistant.md` | AI setup assistant (wave K, §16.5) |
| 2 | `prompts/opus-p9-voice-notes.md` | Voice-note transcription (J6b) |
| 3 | `prompts/opus-p10-campaigns.md` | Template campaigns (J10, spec §17.3) |
| 4 | `prompts/opus-p11-sifen-s2.md` | SIFEN S2: ports, tables, state machines (`PLAN-SIFEN.md`) |

None of them waits on Anton. Lane 2 (Sonnet, `prompts/sonnet-wave2-lane2.md`)
runs at the same time on file-disjoint work; the rules for coexisting with it
are in `prompts/_handoff-w2.md` — read it first, then `plan-booking.md` §4
(autonomy protocol). Build nothing outside the plan. Fable is never spawned.

## The loop, per phase

1. `git checkout main && git pull origin main`, then `git checkout -b phase/<id>`.
2. Read that phase's prompt and only the files it names.
3. Build. Shared conventions (PLAN.md §15.8 bottom): services take
   `TenantContext` first and reach the DB only through `tenantDb`; zod in every
   server action; destructive actions `requireTenantAdmin()` + `writeAuditLog`;
   every string through next-intl in `messages/es|en|sv.json` (parity test);
   tests beside the module. Subagents (Sonnet or Opus, never Fable) for
   file-disjoint pieces inside a phase are fine; review their output yourself.
4. Install MySQL locally and run the whole suite — the recipe is in
   `prompts/sonnet-wave1-lane2.md` ("Running the DB-backed tests locally");
   a run with a large skip count has not tested the phase.
5. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green;
   rebase onto `main`; push; open the PR; wait for CI; green → squash-merge.
6. Gates in `_handoff-w2.md` (audit, `docs/log/<id>.md`, §17.7 index line).
   Then step 1 for the next phase. Do not stop to report between phases.

Order among P9, P10 and P11 is free if one blocks — move on and come back.
K2 goes first because K3 in lane 2 waits for it.

## When all four have merged

Stop with a closing report: what merged, the migrations and env vars Anton
must apply (P9's `AI_AUDIO_DRIVER`, P10's plan limit, P11's none), and the
human checks outstanding (a real voice note transcribed once `AI_DRIVER` is
set; a real template campaign to a five-contact test view; the "Próximamente"
nav item still disabled). Spawn nothing.
