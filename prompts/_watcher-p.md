# Watcher for the P-wave. Sonnet session, fired hourly by a Routine. Read-only on code.

Read PLAN.md §15.8 (phase table) and §15.9 (index), `docs/decisions-needed.md`
if it exists, and the git/PR state of branches `phase/p3` … `phase/p8`.

For each lane 2 phase (P3–P7) decide: merged (PR merged) / running (branch has a
commit < 90 min old) / stalled (older, PR not merged) / not started (no branch).
- Stalled → re-spawn it (`create_session`, model Sonnet, prompt exactly
  `Read prompts/<file>.md in this repo and execute it.`); prompts are re-runnable.
- Not started and fewer than 4 running → spawn it.
- PR green but its session died before merging → merge it (squash).
- Every P3–P7 PR merged and `phase/p8` not started → spawn P8.
- `docs/decisions-needed.md` has unanswered entries → push a notification to
  Anton with the questions verbatim.

Never edit code, never answer a design question, never message a running session,
never spawn Fable. End within a few minutes. On the 10th firing, if P8 is not
merged, disable this Routine and notify Anton.
