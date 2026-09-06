# Phase P10 — Template campaigns to a saved view (J10). OPUS session. Wave 2 lane 1.

Read ONLY: this file, PLAN.md §17.3 "P10" (the eight rules — they are the
spec, quote them in code comments), §17.0 #3, §17.2 (P10 row, conflicts),
§6.4, §7.2 (opt-out), `prompts/_handoff-w2.md`, `plan-booking.md` §4, then
`src/modules/whatsapp/send.ts`, `inbox.ts` (conversation creation),
`templates.ts`, `health.ts`, `graph.ts`, `src/db/schema/crm.ts`
(`contactViews`, `contacts`), `src/modules/crm/contact-list.ts` (how a view's
`query` resolves to rows), `src/modules/tenancy/limits.ts`,
`src/modules/automations/actions.ts` (`OPTOUT_TAG`, the variable renderer),
`src/modules/crm/custom-fields*.ts` (`renderContactCustomVars`),
`src/lib/queue/**` (claim with SKIP LOCKED), `src/worker/maintenance.ts`.

Owns: the P10 row of §17.2. Plus `docs/log/p10.md`.
Hard limits: no new trigger type in `automations/graph.ts`; never call
`getPrimaryAccount` (the account is `campaigns.wa_account_id`); no changes to
`send.ts`'s window/opt-out logic — you call it, you do not reshape it.

Budget: one session, ≤ 90 min. Branch `phase/p10` off latest main.

Phase rules:
- Schema (`src/db/schema/campaigns.ts`, new): `campaigns` (tenant, name,
  wa_account_id, template name/language/category, components json, view id
  + the resolved query snapshot, status `draft | running | paused | done |
  cancelled`, pause_reason, batch_size, interval_minutes, min_days_between,
  business_hours_only, counts json, created_by, launched_at) and
  `campaign_recipients` (campaign, contact, phone, status `pending | sent |
  delivered | read | failed | replied | skipped`, skip_reason, message_id,
  sent_at; unique (campaign, contact)). Additive on existing tables:
  `contacts.wa_marketing_consent_at`, `contacts.wa_marketing_consent_source`
  (`form | import | manual | inbound`), `messages.campaign_id`,
  `wa_accounts.messaging_limit_tier`. One migration.
- `ensureConversation(ctx, accountId, contactId)` exported from
  `whatsapp/inbox.ts`: returns the open conversation for the pair or creates
  one (`status: open`, no `last_inbound_at`). `sendTemplate` is then usable
  for a contact who has never written.
- `refreshQualityRating(ctx, accountId)` in `whatsapp/health.ts`: Graph API
  phone-number fields `quality_rating`, `messaging_limit_tier` → the two
  columns. Reused by the superadmin health page (which finally stops showing "—").
- `modules/campaigns/`: `audience.ts` (pure: apply rule 1's exclusions to a
  contact list, returning counts per reason — unit-tested), `campaigns.ts`
  (CRUD, launch = snapshot recipients in one transaction, pause/resume/cancel,
  admin-only + audit), `pacing.ts` (pure: given quality, tier, failures in the
  last batch, daily count and the plan limit, decide `continue | halve+wait |
  pause` and the next `run_at` inside business hours — unit-tested), `tick.ts`
  (the `campaign.tick` job: claim a batch `FOR UPDATE SKIP LOCKED`, call
  `pacing`, send each via `ensureConversation` + `sendTemplate`, stamp
  `messages.campaign_id`, reschedule or pause with a `notifications` row to
  every admin), `replies.ts` (a listener on `wa.message_received` marks the
  recipient `replied`), `variables.ts` (the flow registry +
  `renderContactCustomVars`).
- Limit: `plans.limits.maxCampaignMessagesPerDay` (default 200) counted from
  `campaign_recipients.sent_at` per tenant per rolling 24 h.
- Consent write paths in this phase: a "consentimiento WhatsApp" checkbox on
  the contact edit form (`source: manual`) and a CSV import column
  (`source: import`) — the hosted-form checkbox is P17's, the inbound
  `source` is set by the webhook when a customer writes first (one line in
  `webhook.ts`, only if null).
- UI `/campaigns`: list, create (pick view → live audience count with the
  exclusion breakdown → pick account → pick an APPROVED template and fill its
  variables → pacing fields with defaults), detail with counts and the
  recipient table, pause/resume/cancel. Agents read-only. Superadmin: paused-
  by-quality rows on `whatsapp-health` and a per-tenant `campaignsEnabled`
  switch on the tenant page.
- Tests: `audience.test.ts`, `pacing.test.ts` (every branch of rule 3, the
  7-day rule, business hours in the tenant tz), and `campaigns.integration.test.ts`
  with the exact scenario in §17.3's exit line plus cross-tenant isolation.

Exit: §17.3 P10's exit paragraph green against MySQL; the superadmin health
page shows a real quality rating after one refresh; lint/typecheck/test/build
green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Next in this session: `prompts/opus-p11-sifen-s2.md`.
