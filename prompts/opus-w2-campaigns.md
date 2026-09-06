# Phase W2 — Template campaigns to a saved view. OPUS session. Wave 2, lane 1. Last lane 1 phase.

Read ONLY: this file, PLAN.md §15.5 (J10), §15.10 (table, conventions, **and
the campaign compliance rules paragraph — it is the spec, not background**),
§11's broadcast deferral, §2.1 (single process, MySQL job queue),
`plan-booking.md` §4, `docs/log/w1.md`, and the code you own:
`src/modules/whatsapp/send.ts`, `templates.ts`, `graph.ts`, `jobs.ts`,
`src/lib/queue/**`, `src/worker/**`, `src/modules/crm/**` (saved views,
read-only), `src/modules/tenancy/**` (settings shape, see P4's
`maxEmailsPerDay`). Do not read the rest.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the W2 row of PLAN.md §15.10. Plus `docs/log/w2.md`.

Budget: one session, ≤ 90 min of work. Branch `phase/w2` off latest main.
WIP commit every 30 min. Open the PR the turn the exit criteria pass.

**The compliance rules in §15.10 are binding.** Every one of them is an exit
criterion, not advice: templates only, audience resolved at send time, opt-out
respected, 7-day per-contact cooldown across all campaigns, paced release
through the jobs table, quality-rating and messaging-limit check before each
batch, per-tenant daily cap, and a readable row for every send, skip and
pause. If a rule cannot be implemented as written (the Graph API does not
expose what it assumes, say), do not soften it silently — implement the
strictest thing that is possible, and write the gap into
`docs/decisions-needed.md` and `docs/log/w2.md`.

Phase rules:
- Tables in `src/db/schema/campaigns.ts`: `campaigns` (tenant, name, template
  name + language + variable mapping, saved-view id, status
  `draft|scheduled|running|paused|done|cancelled`, pause reason, rate per
  minute, scheduled_at, created_by, counters) and `campaign_recipients`
  (campaign, contact, phone snapshot, status `queued|sent|delivered|read|failed|skipped`,
  skip reason, message id, timestamps). One additive migration.
- Job kinds: `campaign.tick` (re-enqueues itself while a campaign is running,
  releases at most `rate` sends per minute, re-reads quality rating and the
  daily cap before each batch) and `campaign.send` (one recipient, through the
  existing `whatsapp.send` path — do not open a second Graph client).
- Statuses come back through the existing message-status webhook
  (`message-status.ts`), keyed by the message id already stored there.
- UI `/campaigns`: list, create (pick a saved view, pick an approved template,
  map variables, preview against the first three contacts of the view, show
  the resolved audience size and how long the send will take at the current
  rate), detail with the per-recipient rows and their skip reasons, and pause /
  resume / cancel. Creating and starting a campaign is `requireTenantAdmin()`
  + `writeAuditLog`; so is cancelling.
- A campaign never sends to a contact whose `optout` is set, whose phone is
  missing or invalid, or who received a campaign message within 7 days —
  each is a `skipped` row with its reason, counted in the summary.
- Tests: audience resolution at send time (contact opts out between schedule
  and send → skipped), cooldown, the daily cap, the pacing loop releasing
  exactly `rate` per tick, a `RED` quality rating pausing rather than sending,
  and the status webhook updating a recipient row.
- Do not touch the inbox, contracts, reports or forms.
- Re-runnable; minor issues → `docs/log/w2.md`; stop only per protocol §4.4.

Exit: a campaign over a saved view of five contacts, one of them opted out and
one messaged three days ago, sends exactly three template messages, records two
skips with reasons, and pauses itself when the stubbed Graph quality rating
turns `RED` — all in the integration suite; the UI renders the recipient rows;
lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md`, then the "When both have merged" section of
`prompts/opus-wave2-lane1.md`: hand lane 2 over as ONE Sonnet session with the
prompt `Read prompts/sonnet-wave2-lane2.md in this repo and execute it.`
Spawn nothing else. Never Fable.
