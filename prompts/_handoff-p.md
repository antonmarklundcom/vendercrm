# Handoff rules for the P-wave (PLAN.md §15.8). Every P phase follows this.

A phase is done when four gates pass: (1) PR merged green; (2) every exit
criterion in the prompt checked; (3) pre-handoff audit: ONE re-run of lint,
typecheck, test and build on main, ONE adversarial re-read of the merged diff,
findings fixed in ONE follow-up commit, no second round; (4) `docs/log/<phase>.md`
committed (≤ 12 lines Built, ≤ 8 Decisions, ≤ 8 Known issues, one Verification
line) and its index line added to PLAN.md §15.9.

Then:
- **Lane 1 phase (P1)** → `create_session` (inherit environment and permission
  mode, never `plan`; `model` exactly as the §15.8 table says, never Fable)
  with prompt exactly `Read prompts/<next-file>.md in this repo and execute it.`
- **Last lane 1 phase (P2)** → hand lane 2 over as ONE session: prompt exactly
  `Read prompts/sonnet-wave1-lane2.md in this repo and execute it.`, model
  Sonnet. That session runs P3 → P8 in order, one PR per phase, merging each
  before starting the next. Spawn nothing else.
- **Lane 2 phase (P3–P8)** → you are inside that one session: go straight to
  the next phase in `sonnet-wave1-lane2.md`'s table without stopping to report.
- **Link pass (P8)** → stop with the closing report. Spawn nothing.
- No `create_session` available → continue in this window if the next phase
  uses the same model; stop and report at a model switch.

Lane 2 is deliberately sequential rather than four parallel sessions with a
watcher Routine: P3–P7 all add keys to the same three `messages/*.json` files
and all append to PLAN.md §15.9, so parallel branches conflict on the way in
and the rebase costs more than the wall-clock it saved. One session, six
merges, each starting from a `main` that already holds the one before it.

Questions only Anton can answer go to `docs/decisions-needed.md` (commit, push,
carry on with the next phase). Never wait in a session for an answer; never
message a running session. Fable is never spawned (plan-booking.md §4.8).
