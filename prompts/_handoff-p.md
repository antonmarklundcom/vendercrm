# Handoff rules for the P and K waves (PLAN.md §15.8, §16.6). Every phase follows this.

Anton pastes exactly one line (P1). Everything after that is spawned by a
finished phase or by the watcher. No phase ever waits for a human.

A phase is done when four gates pass: (1) PR merged green — the phase merges
its own PR (squash) the moment CI is green; a red build is the phase's own
work; (2) every exit criterion in the prompt checked; (3) pre-handoff audit:
ONE re-run of lint, typecheck, test and build on main, ONE adversarial re-read
of the merged diff, findings fixed in ONE follow-up commit, no second round;
(4) `docs/log/<phase>.md` committed (≤ 12 lines Built, ≤ 8 Decisions, ≤ 8
Known issues, one Verification line) and its index line added to PLAN.md
§15.9 (P phases) or §16.8 (K phases).

Spawning (`create_session`: inherit environment and permission mode, never
`plan`; `model` exactly as the phase table says — Opus for P1, P2, K2, Sonnet
for the rest, never Fable; prompt exactly
`Read prompts/<file>.md in this repo and execute it.`):

- **P1, at its very start, before any code**: create the watcher Routine from
  `prompts/_watcher-p.md` (hourly cron, `create_new_session_on_fire: true`,
  model Sonnet, prompt exactly `Read prompts/_watcher-p.md in this repo and
  execute it.`). If a Routine with that prompt already exists, do not create
  a second one. From this moment every phase, Opus or Sonnet, is restarted
  by the watcher if it stalls.
- **P1, when done** → spawn **P2** (Opus) and **K2** (Opus) together. They are
  file-disjoint and both depend only on merged work.
- **P2, when done** → spawn **P3, P4, P5, P6** (Sonnet) at once; the watcher
  starts P7 when a slot frees and P8 when P3–P7 are merged.
- **K2, when done** → spawn nothing; the watcher starts **K3** when P8 and K2
  are both merged.
- **P3–P7, K3** → spawn nothing; end with the phase report.
- **P8** → after merging, if K3 is already merged, delete the watcher Routine
  and stop with the closing report; otherwise leave the watcher running (it
  deletes itself after K3) and stop with the closing report.
- No `create_session` available → continue in this window if the next phase
  uses the same model; stop and report at a model switch.

Questions only Anton can answer go to `docs/decisions-needed.md` (commit, push,
end the session). Never wait in a session for an answer; never message a
running session. Fable is never spawned (plan-booking.md §4.8).
