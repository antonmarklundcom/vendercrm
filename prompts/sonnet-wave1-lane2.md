# Wave 1 lane 2 — P3 to P8, one Sonnet session, end to end

You are the single session that finishes wave 1 (PLAN.md §15.8). Lane 1 (P1,
P2) is merged. Six phases are left and they are all yours, in this order:

| # | Prompt | Builds |
|---|---|---|
| 1 | `prompts/sonnet-p3-inbox.md` | Inbox ergonomics |
| 2 | `prompts/sonnet-p4-email-identity.md` | Per-tenant email identity |
| 3 | `prompts/sonnet-p5-pipeline-custom-fields.md` | Pipeline polish + custom fields |
| 4 | `prompts/sonnet-p6-quote-accept-receipts.md` | Online quote accept + receipts |
| 5 | `prompts/sonnet-p7-hoy-panel.md` | The "Hoy" dashboard panel |
| 6 | `prompts/sonnet-p8-link-pass.md` | Link pass — **last, after the other five have merged** |

Execute under the autonomy protocol (`plan-booking.md` §4) and the handoff
gates (`prompts/_handoff-p.md`). Build nothing outside the plan.

## Run them one at a time, not in parallel

This replaces the earlier plan of four parallel sessions plus a watcher
Routine. The reason is concrete rather than stylistic: **every one of P3–P7
adds keys to the same three files** — `messages/es.json`, `messages/en.json`,
`messages/sv.json` — and every one appends a line to PLAN.md §15.9. P4 and P8
also both touch the settings page. Branches built in parallel conflict there
on the way in, and the rebase costs more than the wall-clock it saved.

Sequential also gives each phase something worth having: a `main` that already
contains the phase before it, so a rebase is never needed and the locale parity
test is only ever answering for one phase's keys at a time.

P4, P5 and P6 depend only on P1, so their order among themselves is free — if
one of them blocks on something, move to the next and come back rather than
stopping the run.

Parallelism inside a single phase is fine and often right: if a phase's own
prompt describes several file-disjoint pieces, fan them out as subagents
(Sonnet or Opus — never Fable, and never a spawned session for this) and
review the result yourself before committing.

## The loop, per phase

1. `git checkout main && git pull origin main` — start every phase from the
   tip, never on top of an unmerged branch.
2. `git checkout -b phase/<id>`.
3. Read that phase's prompt file and only the files it tells you to read.
4. Build it. Tests beside the module, strings through next-intl in all three
   locales, services take `TenantContext` first and reach the DB only through
   `tenantDb` — the shared conventions at the bottom of §15.8.
5. Verify locally: `npm run lint`, `npm run typecheck`, `npm test`,
   `npm run build`. All four, before pushing.
6. `git push -u origin phase/<id>`, open the PR, wait for both CI jobs.
7. **Green → squash-merge it.** Then go to step 1 for the next phase.

Do not stop between phases to report or ask. One session, six merges.

### Running the DB-backed tests locally

The container has no MySQL by default, so the integration suites skip and
`npm test` looks green while a third of it never ran. P2 found that you can
just install one, and it is worth the four minutes:

```
apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mysql-server
mkdir -p /var/run/mysqld && chown mysql:mysql /var/run/mysqld
(mysqld_safe > /tmp/mysqld.log 2>&1 &) && sleep 20
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS vendercrm;
  ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'root';
  CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY 'root';
  GRANT ALL ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;"
```

Then write the CI env block from `.github/workflows/ci.yml` into a local
`.env` (it is gitignored), `npm run db:migrate`, and run the suite with those
values exported — vitest does not read `.env` itself:

```
set -a; . ./.env; export AI_DRIVER=openai OPENAI_API_KEY=ci-dummy-openai-key \
  AI_BASE_URL=http://127.0.0.1:9/unused; set +a; npx vitest run
```

A full run is ~860 tests with **0 skipped**. If you see a large skip count,
the database is not connected and you have not actually tested the phase.

## If merging is refused

Some sessions are not permitted to merge. If the squash-merge is denied, do
not work around it — never push to `main` directly, and never close and
reopen the PR. Instead: leave the PR open and green, say plainly in your reply
which PR is waiting and why, and **continue with the next phase anyway**,
branching it off the still-unmerged tip of the previous phase rather than off
`main`. Note in that phase's PR body that it stacks on the previous one and
must be merged after it. Anton merges the queue in order.

## Gates before moving on

From `prompts/_handoff-p.md`, per phase: every exit criterion in the prompt
checked; one re-run of lint/typecheck/test/build and one adversarial re-read
of your own diff, findings fixed in one follow-up commit, no second round;
`docs/log/<phase>.md` committed (≤12 lines Built, ≤8 Decisions, ≤8 Known
issues, one Verification line) and its index line added to PLAN.md §15.9.

## When you are blocked

A missing credential with no graceful fallback, or a foundation decision
(schema shape, money math) where a wrong guess forces a rewrite: append the
question to `docs/decisions-needed.md`, commit and push it, and move to the
next phase. Never wait inside the session for an answer, and never invent one
for money or schema.

Everything else: choose reasonably and record it in the phase's log.

## When all six have merged

Stop with the closing report P8's prompt describes — what merged, the env vars
and migrations Anton must apply, and the human checks still outstanding (web
push on an installed Android PWA, email from a tenant's own domain). Spawn
nothing. Wave 2's prompts are written after wave 1 is in.
