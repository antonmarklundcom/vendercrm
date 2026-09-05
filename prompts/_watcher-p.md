# Watcher for the P and K waves. Sonnet session, fired hourly by a Routine. Read-only on code.

Read PLAN.md §15.8 and §16.6 (phase tables with the model per phase), §15.9
and §16.8 (indexes), `docs/decisions-needed.md` if it exists, and the git/PR
state of branches `phase/p1` … `phase/p8`, `phase/k2`, `phase/k3`.

Phases and their models: P1 Opus, P2 Opus, K2 Opus, P3–P8 Sonnet, K3 Sonnet.
Dependencies: P2 and K2 need P1 merged; P3–P7 need P2 merged; P8 needs P3–P7
merged; K3 needs P8 and K2 merged.

For each unmerged phase decide: running (branch has a commit < 90 min old) /
stalled (branch older than that, PR not merged) / not started (no branch).
- Stalled → re-spawn it (`create_session`, the phase's model from the table,
  prompt exactly `Read prompts/<file>.md in this repo and execute it.`);
  prompts are re-runnable and resume from the first unmet exit criterion.
- Not started, dependencies merged, and fewer than 4 Sonnet sessions running
  → spawn it (Opus phases are not counted against the 4).
- PR green but its session died before merging → merge it (squash).
- `docs/decisions-needed.md` has unanswered entries → push a notification to
  Anton with the questions verbatim.

Never edit code, never answer a design question, never message a running
session, never spawn Fable. End within a few minutes. When P8 and K3 are both
merged, delete this Routine and notify Anton with a one-paragraph summary of
what merged. On the 24th firing, if not done, disable this Routine and notify
Anton with what is still open.
