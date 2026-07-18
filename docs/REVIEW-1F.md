# 1F review notes — for the Fable review gate

Sub-phase 1F (automation flow builder) is built and its exit criteria pass.
This is the third Opus-tier review gate (with 1B and 1D) — the execution
engine is the reliability-critical piece, so this note focuses there.

## 1. The wait-for-reply/timeout race — how it's resolved

PLAN.md §7.2 calls for resolving the race with "compare-and-set on
flow_runs.status". Implementation in `engine.ts`'s `resumeRun()`:

```
UPDATE flow_runs SET status='running', wait_for=NULL, wait_until=NULL
WHERE id=? AND status='waiting' AND current_node_id=?
```

Whichever caller's UPDATE affects a row wins; the other's affects zero rows
and returns immediately as a no-op. Both the inbound-reply handler
(`automations/inbound.ts`) and the timeout job (`automations/jobs.ts`,
enqueued at wait-entry time with `run_at` = the timeout deadline) call this
same function — there is exactly one code path that can transition a run out
of `waiting`, and it's guarded by the row's current status, not by anything
in memory.

Verified directly: `flagship.integration.test.ts`'s "reply path" test lets a
run resume via reply, then forces the *already-scheduled* timeout job due and
drains the queue again — asserting the follow-up step never runs. This is the
actual race being exercised, not just unit-tested in isolation.

## 2. Nothing here holds workflow state in memory

`advanceRun()` reloads the run, its published graph version, and its step
count from the database on every invocation — there is no long-lived process
holding a run's position. "Survives a process restart mid-wait" is
demonstrated in the flagship test by writing the resume job's `run_at` into
the past and draining the queue fresh, exactly as a restarted worker would.

## 3. `flow_runs` "one active run" guard — no DB-level unique constraint

PLAN.md §4/§7.2 implies a hard guard here. I originally implemented it as a
generated-column partial-unique-index (NULL when terminal, so MySQL's
"unlimited NULLs in a unique index" gives a for-free partial index). **This
does not work on MariaDB**: `CONCAT()`/string functions are rejected in
`GENERATED ALWAYS AS` when the arguments are fixed-width `CHAR` columns
(every PK/FK in this schema is `char(26)`) — confirmed by direct DDL testing,
not assumed. Since the codebase's local dev/test path runs on MariaDB and the
production target is MySQL 8, I did not want a guard whose correctness
depends on which flavor is running.

**Current implementation**: enforced in `engine.ts`'s `startRun()` via
`SELECT ... FOR UPDATE` on `(flow_id, contact_id)` inside a transaction before
inserting — the identical locking pattern the job queue already uses
(`worker/claim.ts`). This is correct under the actual concurrency model
(PLAN.md §2.1: single Node process, single worker) but is application-level,
not DB-level. If the worker is ever split into multiple processes against the
same MySQL (the scaling path §2.1 explicitly allows), this guard is still
correct — `SELECT ... FOR UPDATE` locks across connections/processes, not
just within one. Flagged in case a DB-level constraint is still wanted on
real MySQL 8 (worth confirming string functions over `char(26)` behave there
before adding one).

## 4. Trigger matching is data, not code, across the job boundary

Domain events (`lib/events`) are emitted synchronously in-process, but
flow-matching happens in a durable `automation.trigger` job — matching the
plan's explicit instruction. That meant the original design (a JS closure as
a "matcher") couldn't survive serialization into a job payload, so trigger
matching was rewritten as a pure function
(`matchesTriggerConfig(triggerType, config, fields)`) over a small
JSON-serializable `TriggerMatchFields` shape. `deal.stage_changed` needed a
`pipelineId` added to its event payload (it only carried stage ids before) so
`deal_stage_changed` triggers can match on pipeline+stage.

## 5. Guards implemented exactly as specified (§7.2)

- Max one active run per (flow, contact) — §3 above.
- `stop_on_reply` (default true, per-flow): any inbound reply cancels the
  contact's other active runs of that flow, *except* a run currently parked
  at the exact `wait_for_reply` node awaiting that reply, which resumes
  instead of being cancelled.
- Opt-out: `BAJA`/`STOP`/etc. auto-tags the contact; the tag is checked
  inside every `send_wa_message`/`send_wa_template` action (skipped, not
  failed) — other action types still run normally for an opted-out contact,
  matching the plan's "skipped by every send action" wording literally.
- Per-tenant automation-run cap: reads `plans.limits.automationRunsPerMonth`
  via the existing billing service (not raw `db` — `plans`/`subscriptions`
  split between platform/tenant scope, same as 1B).
- Max 100 steps: hard stop, run marked `failed`, verified with a 101-node
  chain (not a cycle — cycle detection at save time already rejects those).

## 5b. Test-suite fixes (not product bugs, but worth knowing about)

Wiring real events to real jobs meant every `contact.created` (and other)
event across the *whole test run* now enqueues a job into the shared `jobs`
table — which is one physical table, never reset between test files within a
single `vitest run`. Three follow-on issues surfaced and were fixed:

1. **Cross-file interleaving.** Vitest's default parallel file execution let
   one file's `worker.tick()` steal-claim a job another file had just
   enqueued. Fixed with `fileParallelism: false` in `vitest.config.ts`.
2. **Timeouts under load.** The default 5s per-test timeout was too tight for
   tests that drain a real queue in a loop. Raised to 30s.
3. **The real bug, in a pre-1F test**: `worker/index.integration.test.ts`
   assumed "the very next `tick()` call claims the job I just inserted" —
   true in isolation, false once other suites' jobs share the same table.
   `claimNextJob` correctly claims whichever due job has the earliest
   `run_at`, not a specific one; that's correct queue behavior, and the old
   test's assumption was the bug. Fixed by ticking until *that specific job*
   reaches the expected state (`tickUntil`), the same pattern every other
   integration suite already used. Verified clean across 8+ consecutive full
   runs after the fix (vs. roughly 50% failure before it).

Also removed each integration test's `db.$client.end()` pool-close in
`afterAll` — a red herring I chased first (the actual failures kept
reproducing after removing it), but still worth keeping removed since
closing a module-level singleton pool from one test file's teardown while
other files may still be using the same cached module is fragile regardless.

## Exit criteria — verified

- Flagship scenario end-to-end, both branches (timeout and reply), against a
  real MySQL: `automations/flagship.integration.test.ts`.
- Guards: `automations/guards.integration.test.ts` (one-run cap, max-steps,
  stop-on-reply, opt-out).
- Isolation merge gate extended: `automations/isolation.integration.test.ts`.
- Editor + runs monitoring UI verified over real HTTP (create → save draft →
  publish → list runs), not just typechecked.
