# Wave 2 lane 1 — W1 and W2, one Opus session, end to end

You are the lane 1 session of wave 2 (PLAN.md §15.10). Wave 1 is merged
(§15.9). Two phases are yours, in this order:

| # | Prompt | Builds |
|---|---|---|
| 1 | `prompts/opus-w1-voice-notes.md` | Voice-note transcription (J6b) |
| 2 | `prompts/opus-w2-campaigns.md` | Template campaigns to a saved view (J10) |

Execute under the autonomy protocol (`plan-booking.md` §4) and the handoff
gates (`prompts/_handoff-p.md`). Build nothing outside the plan.

Both are Opus phases because both add a seam later work calls: W1 puts audio
behind the existing AI driver interface (W4's weekly briefing and any future
L3 coach reuse the same ledger and caps), and W2 adds the paced-send job pair
that any later outbound batch — email campaigns, reminders at scale — will
copy. Run them one at a time in this one session, not as two spawned
sessions and never in parallel: both touch `messages/*.json` and both append
to §15.11.

## The loop, per phase

1. `git checkout main && git pull origin main` — start every phase from the
   tip, never on top of an unmerged branch.
2. `git checkout -b phase/<id>` (`phase/w1`, then `phase/w2`).
3. Read that phase's prompt file and only the files it tells you to read.
4. Build it. Tests beside the module, strings through next-intl in all three
   locales, services take `TenantContext` first and reach the DB only through
   `tenantDb` — the shared conventions at the bottom of §15.10.
5. Verify locally: `npm run lint`, `npm run typecheck`, `npm test`,
   `npm run build`. All four, before pushing.
6. `git push -u origin phase/<id>`, open the PR, wait for both CI jobs.
7. **Green → squash-merge it.** Then go to step 1 for the next phase.

Parallelism *inside* a phase is fine: if a phase's prompt describes
file-disjoint pieces, fan them out as subagents (Sonnet or Opus — never
Fable, never a spawned session for this) and review the result yourself
before committing.

### Running the DB-backed tests locally

Same as wave 1 — the container has no MySQL, so the integration suites skip
silently and `npm test` looks green while a third of it never ran:

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
`.env` (gitignored), `npm run db:migrate`, and run the suite with those
values exported — vitest does not read `.env` itself:

```
set -a; . ./.env; export AI_DRIVER=openai OPENAI_API_KEY=ci-dummy-openai-key \
  AI_BASE_URL=http://127.0.0.1:9/unused; set +a; npx vitest run
```

A large skip count means the database is not connected and you have not
actually tested the phase.

## If merging is refused

Some sessions are not permitted to merge. If the squash-merge is denied, do
not work around it — never push to `main` directly, and never close and
reopen the PR. Leave the PR open and green, say plainly which PR is waiting,
and continue with the next phase anyway, branching it off the still-unmerged
tip of the previous phase rather than off `main`. Note in that PR body that
it stacks on the previous one. Anton merges the queue in order.

## Gates before moving on

From `prompts/_handoff-p.md`, per phase: every exit criterion in the prompt
checked; one re-run of lint/typecheck/test/build and one adversarial re-read
of your own diff, findings fixed in one follow-up commit, no second round;
`docs/log/<phase>.md` committed (≤12 lines Built, ≤8 Decisions, ≤8 Known
issues, one Verification line) and its index line added to PLAN.md §15.11.

## When you are blocked

A missing credential with no graceful fallback, or a foundation decision
(schema shape, money math, a compliance rule the §15.10 spec paragraph does
not settle) where a wrong guess forces a rewrite: append the question to
`docs/decisions-needed.md`, commit and push it, and move on. Never wait
inside the session for an answer, and never invent one for money, schema or
Meta policy. Everything else: choose reasonably and record it in the log.

## When both have merged

Hand lane 2 over as ONE Sonnet session (`create_session`, inheriting
environment and permission mode, never `plan`, model Sonnet) with the prompt
exactly:

`Read prompts/sonnet-wave2-lane2.md in this repo and execute it.`

That session runs W3 → W8 in order, one PR per phase. Spawn nothing else,
and never spawn Fable (`plan-booking.md` §4.8). If `create_session` is not
available, stop with a closing report naming the two merged PRs, the
migrations and env vars Anton must apply, and the exact prompt above so he
can start lane 2 himself.
