# Handoff rules for the P-wave (PLAN.md §15.8). Every P phase follows this.

A phase is done when four gates pass: (1) PR merged green; (2) every exit
criterion in the prompt checked; (3) pre-handoff audit: ONE re-run of lint,
typecheck, test and build on main, ONE adversarial re-read of the merged diff,
findings fixed in ONE follow-up commit, no second round; (4) `docs/log/<phase>.md`
committed (≤ 12 lines Built, ≤ 8 Decisions, ≤ 8 Known issues, one Verification
line) and its index line added to PLAN.md §15.9.

Then:
- **Lane 1 phase** → `create_session` (inherit environment and permission mode,
  never `plan`; `model` exactly as the §15.8 table says, never Fable) with
  prompt exactly `Read prompts/<next-file>.md in this repo and execute it.`
- **Last lane 1 phase (P2)** → create the watcher Routine (`prompts/_watcher-p.md`:
  hourly cron, `create_new_session_on_fire: true`, model Sonnet, prompt exactly
  `Read prompts/_watcher-p.md in this repo and execute it.`), then spawn P3–P7
  at once, at most 4 concurrently; the watcher starts the rest.
- **Lane 2 phase** → spawn nothing; end with the phase report.
- **Link pass (P8)** → delete the watcher Routine, then stop with the closing report.
- No `create_session` available → continue in this window if the next phase uses
  the same model; stop and report at a model switch.

Questions only Anton can answer go to `docs/decisions-needed.md` (commit, push,
end the session). Never wait in a session for an answer; never message a running
session. Fable is never spawned (plan-booking.md §4.8).
