# Wave 2 lane 2 — W3 to W8, one Sonnet session, end to end

You are the single session that finishes wave 2 (PLAN.md §15.10). Lane 1 (W1
voice notes, W2 campaigns) is merged. Six phases are left and they are all
yours, in this order:

| # | Prompt | Builds |
|---|---|---|
| 1 | `prompts/sonnet-w3-contracts.md` | Contracts with click-to-accept (J5) |
| 2 | `prompts/sonnet-w4-weekly-briefing.md` | Weekly AI briefing (J7) |
| 3 | `prompts/sonnet-w5-reporting.md` | Reporting v2 (J11a) |
| 4 | `prompts/sonnet-w6-forms-editor.md` | Forms field editor (J11b) |
| 5 | `prompts/sonnet-w7-companies-merge.md` | Companies + contact merge (J11c) |
| 6 | `prompts/sonnet-w8-link-pass.md` | Link pass — **last, after the other five have merged** |

Execute under the autonomy protocol (`plan-booking.md` §4) and the handoff
gates (`prompts/_handoff-p.md`). Build nothing outside the plan.

## Run them one at a time, not in parallel

Same reason wave 1's lane 2 was sequential and it has not changed: W3–W7 all
add keys to `messages/es.json`, `messages/en.json` and `messages/sv.json`, and
all append a line to PLAN.md §15.11. Parallel branches conflict there on the
way in and the rebase costs more than the wall-clock it saved. Sequential also
means each phase starts from a `main` that already holds the one before it, so
the locale parity test only ever answers for one phase's keys at a time.

W3, W5 and W6 depend on nothing but merged wave-1 code, so their order among
themselves is free — if one blocks, move to the next and come back rather than
stopping the run. W7 wants W5 merged first (both touch contact list queries).

Parallelism inside a single phase is fine and often right: if a phase's prompt
describes several file-disjoint pieces, fan them out as subagents (Sonnet or
Opus — never Fable, and never a spawned session for this) and review the
result yourself before committing.

## The loop, per phase

1. `git checkout main && git pull origin main`.
2. `git checkout -b phase/<id>`.
3. Read that phase's prompt file and only the files it tells you to read.
4. Build it, under the §15.10 shared conventions.
5. Verify locally: `npm run lint`, `npm run typecheck`, `npm test`,
   `npm run build`. All four, before pushing.
6. `git push -u origin phase/<id>`, open the PR, wait for both CI jobs.
7. **Green → squash-merge it.** Then go to step 1 for the next phase.

Do not stop between phases to report or ask. One session, six merges.

### Running the DB-backed tests locally

The container has no MySQL by default, so the integration suites skip and
`npm test` looks green while a third of it never ran:

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
`.env` (gitignored), `npm run db:migrate`, and run the suite with those values
exported — vitest does not read `.env` itself:

```
set -a; . ./.env; export AI_DRIVER=openai OPENAI_API_KEY=ci-dummy-openai-key \
  AI_BASE_URL=http://127.0.0.1:9/unused; set +a; npx vitest run
```

A large skip count means the database is not connected and you have not
actually tested the phase.

## If merging is refused

Leave the PR open and green, say plainly which PR is waiting and why, and
continue with the next phase anyway, branching it off the still-unmerged tip
of the previous phase rather than off `main`. Note in that PR body that it
stacks on the previous one. Never push to `main` directly; never close and
reopen a PR to kick CI.

## Gates before moving on

From `prompts/_handoff-p.md`, per phase: every exit criterion checked; one
re-run of lint/typecheck/test/build and one adversarial re-read of your own
diff, findings fixed in one follow-up commit, no second round;
`docs/log/<phase>.md` committed (≤12 lines Built, ≤8 Decisions, ≤8 Known
issues, one Verification line) and its index line added to PLAN.md §15.11.

## When you are blocked

A missing credential with no graceful fallback, or a foundation decision
(schema shape, money math, the legal wording on a contract page) where a wrong
guess forces a rewrite: append the question to `docs/decisions-needed.md`,
commit and push it, and move to the next phase. Never wait inside the session
for an answer, and never invent one for money, schema or law.

Everything else: choose reasonably and record it in the phase's log.

## When all six have merged

Stop with the closing report W8's prompt describes — what merged, the env vars
and migrations Anton must apply, and the human checks still outstanding. Spawn
nothing. Wave 3's prompts are written after wave 2 is in, and J8/J9/SIFEN stay
gated for the reasons §15.10 gives.
