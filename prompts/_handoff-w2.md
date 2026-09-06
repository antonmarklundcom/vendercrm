# Handoff rules for wave 2 (PLAN.md §17). Every wave 2 phase follows this.

A phase is done when four gates pass: (1) PR merged green; (2) every exit
criterion in the prompt checked; (3) pre-handoff audit: ONE re-run of lint,
typecheck, test and build on main, ONE adversarial re-read of the merged diff,
findings fixed in ONE follow-up commit, no second round; (4) `docs/log/<phase>.md`
committed (≤ 12 lines Built, ≤ 8 Decisions, ≤ 8 Known issues, one Verification
line) and its index line added to PLAN.md §17.7 (K-phases: §16.8 as well).

Wave 2 runs as **two concurrent sequential sessions**: lane 1 is one Opus
session (`prompts/opus-wave2-lane1.md`), lane 2 is one Sonnet session
(`prompts/sonnet-wave2-lane2.md`). Inside a lane you go straight to the next
phase without stopping to report. Nobody spawns anything: no `create_session`,
no watcher Routine, no Fable (`plan-booking.md` §4.8). P12 (embedded signup) is
outside both lanes and is started by Anton when Meta approval lands.

Because the other lane is merging while you work, every phase:
- branches off the tip of `main` at the moment it starts (`git pull` first);
- rebases onto `main` before opening or merging the PR;
- expects append-only conflicts only in the files PLAN.md §17.2 lists
  (`messages/*.json`, `src/worker/index.ts`, `src/worker/maintenance.ts`,
  `src/db/schema/crm.ts`, `src/db/schema/ai.ts`, `KNOWN-ISSUES.md`, PLAN.md
  §17.7) and resolves them by keeping both sides;
- takes its migration number from `main` at rebase time — if `main` already
  has your number, regenerate as the next one, never edit a merged migration.

Questions only Anton can answer go to `docs/decisions-needed.md` (commit, push,
carry on with the next phase). Never wait in a session for an answer; never
message the other lane's session; never invent an answer for money, schema or
fiscal rules.

If merging is refused: leave the PR open and green, say which PR waits and
why, branch the next phase off the unmerged tip, note the stacking in its PR
body, and continue. Never push to `main` directly.
