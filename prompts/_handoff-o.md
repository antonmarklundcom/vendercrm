# Handoff rules for the Claude Ops wave (PLAN.md §18). Both phases follow this.

A phase is done when four gates pass: (1) PR merged green; (2) every exit
criterion in the prompt checked; (3) pre-handoff audit: ONE re-run of lint,
typecheck, test and build on main, ONE adversarial re-read of the merged diff,
findings fixed in ONE follow-up commit, no second round; (4) `docs/log/<phase>.md`
committed (≤ 12 lines Built, ≤ 8 Decisions, ≤ 8 Known issues, one Verification
line) and its index line added to PLAN.md §18.7.

Two phases, two windows, sequential: O1 (Opus) first; O2 (Sonnet) starts only
after O1's PR is merged, because it renders O1's tables. Nobody spawns anything:
no `create_session`, no watcher Routine, no Fable (§17.8). Anton opens each
window himself.

Every phase: branch off the tip of `main` (`git pull` first); rebase onto `main`
before opening or merging; migration number taken from `main` at rebase time,
never edit a merged migration; append-only conflicts in `messages/*.json`,
`src/db/schema/index.ts`, PLAN.md §18.7 are resolved by keeping both sides.

Questions only Anton can answer go to `docs/decisions-needed.md` (commit, push,
carry on). Never wait in a session for an answer. Never widen the token's
powers to make a test pass: §18.1.2 is the security boundary of this wave.
Never push to `main` directly.
