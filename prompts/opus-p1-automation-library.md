# Phase P1 — Automation library + trigger labels + notification rows. OPUS session. Lane 1.

Read ONLY: this file, PLAN.md §15.0, §15.5 (J1), §15.8 table and conventions,
§7 (automation design), `plan-booking.md` §4 (autonomy protocol), `docs/HANDOFF.md`
Part 2A conventions. Then the code you own. Do not read the rest.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the P1 row of PLAN.md §15.8. Plus `docs/log/p1.md`.

Budget: one session, ≤ 90 min of work. Branch `phase/p1` off latest main. WIP
commit every 30 min. When the exit criteria pass, open the PR that turn.

Phase rules:
- Triggers: add `quote_sent`, `quote_accepted` (emit point lands in P6; declare
  the event type now), `document_sent`, `document_paid` (fires once, when the
  ledger reaches the total — use `getDocumentTotals`), `deal_won`, `deal_lost`
  (emit from `closeDeal`, alongside the existing stage_changed), `contract_accepted`
  (type only, no emitter yet). Follow the `deal.stage_changed` pattern end to
  end: module `events.ts` → `triggers.ts` listener → `fireTrigger` → `TRIGGER_TYPES`
  → schema enum → i18n. Also add labels for the five triggers that have none.
- Actions: `create_task` (title, dueIn hours, assignee = deal owner | contact
  owner | specific), `notify_user` (writes a `notifications` row: tenant, user,
  kind, title, body, url, read_at; P2 delivers it by push; until then it is
  in-app only — add a small bell list in the app nav header), `send_email`
  (subject, body with the same `{{variables}}` as WhatsApp, to contact email;
  no-op with a logged step when the contact has no email or Resend is unset;
  skipped for `optout`).
- Conditions: `deal_value` (gte/lt amount), `lead_source` (equals), `site` (equals),
  `contact_field` (custom key equals/contains — reads `contacts.custom`).
- Run detail page `/automations/[id]/runs/[runId]` listing `flow_run_steps`.
- Extend the i18n parity test so every `TRIGGER_TYPES`, condition kind and
  action kind has a label in es/en/sv; the FlowEditor palette gets the new nodes.
- Do not touch inbox, quotes public pages, crm list code or the dashboard.
- Re-runnable; minor issues → docs/log/p1.md; stop only per protocol §4.4.

Exit: integration test "quote sent → wait → no reply → template" and "document
paid → deal_won stage" green in CI; parity test asserts all labels; run detail
page renders steps; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md`. Next: `prompts/opus-p2-web-push.md`, model Opus.
