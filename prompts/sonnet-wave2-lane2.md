# Wave 2 lane 2 — P13 to P18 plus K3, one Sonnet session, end to end

You are the single Sonnet session for wave 2's lane 2 (PLAN.md §17.2). Seven
phases, all yours, in this order, one PR each, each merged before the next:

| # | Prompt | Builds | Wait on |
|---|---|---|---|
| 1 | `prompts/sonnet-p13-contracts.md` | Contracts (J5) | — |
| 2 | `prompts/sonnet-p14-briefing.md` | Weekly AI briefing (J7) | — |
| 3 | `prompts/sonnet-p15-reporting.md` | Reporting v2 (J11a) | — |
| 4 | `prompts/sonnet-p16-companies-merge.md` | Companies + contact merge (J11c) | — |
| 5 | `prompts/sonnet-p17-forms-editor.md` | Forms field editor (J11b) | P10 merged, for the consent field only |
| 6 | `prompts/sonnet-k3-memory-imports.md` | Memory imports, variables, coach rows (§16.6) | K2 merged — else skip and log |
| 7 | `prompts/sonnet-p18-link-pass.md` | Link pass — **last** | everything above |

None of 1–4 waits on Anton or on lane 1. Lane 1 (Opus,
`prompts/opus-wave2-lane1.md`) runs at the same time on file-disjoint work; the
rules for coexisting with it are in `prompts/_handoff-w2.md` — read it first,
then `plan-booking.md` §4. Build nothing outside the plan. Fable is never
spawned.

## Sequential inside the lane, for the wave 1 reason

Every phase adds keys to `messages/es|en|sv.json` and a line to PLAN.md §17.7;
P13 and P16 both touch `contacts/[id]`. One session, seven merges, each
starting from a `main` that holds the one before. Subagents (Sonnet or Opus,
never Fable) for file-disjoint pieces inside a phase are fine; review their
output yourself before committing.

## The loop, per phase

1. `git checkout main && git pull origin main`, `git checkout -b phase/<id>`.
2. Read that phase's prompt and only the files it names.
3. Build. Conventions (PLAN.md §15.8 bottom): `TenantContext` first,
   `tenantDb` only, zod in every action, admin-only + audit for destructive
   actions, next-intl in all three locales, tests beside the module,
   `useActionState`-shaped forms (§10 1R #6).
4. Install MySQL locally and run the whole suite — recipe in
   `prompts/sonnet-wave1-lane2.md` ("Running the DB-backed tests locally");
   a large skip count means you have not tested the phase.
5. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green;
   rebase onto `main` (lane 1 may have merged meanwhile — keep both sides in
   the append-only files `_handoff-w2.md` lists); push; PR; CI green →
   squash-merge.
6. Gates in `_handoff-w2.md` (audit, `docs/log/<id>.md`, §17.7 index; K3 also
   §16.8). Then step 1 for the next phase. No stopping to report.

If a phase's "wait on" is not met when you reach it: P17 builds without the
consent field type and logs it; K3 is skipped entirely and logged. Do not
wait for lane 1.

## When all have merged

Stop with the closing report P18's prompt describes. Spawn nothing.
