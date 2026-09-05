# Phase P4 — Email identity and delivery surfaces. SONNET session. Lane 2, parallel.

Read ONLY: this file, PLAN.md §15.1 (the whole email decision), §15.5 (J3),
§15.8, `plan-booking.md` §4, `docs/log/p1.md`, then `src/lib/email/index.ts`,
`src/modules/tenancy/settings.ts`, `src/app/(app)/settings/**`, the quote,
document and booking detail pages' action files.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the P4 row of PLAN.md §15.8. Plus `docs/log/p4.md`.
Hard limits: no changes to automations, inbox, crm list code, quotes public
pages; the `send_email` action from P1 must keep working and pick up `senderFor`.

Budget: one session, ≤ 90 min. Branch `phase/p4` off latest main.

Phase rules:
- `senderFor(ctx)` in `src/lib/email/sender.ts`: verified own domain → tenant
  from address; else default `"<tenant name>" <notificaciones@${EMAIL_DEFAULT_DOMAIN}>`
  with reply-to the tenant's contact email. `sendEmail` gains `from`, `replyTo`,
  `tenantId`, `kind` (transactional | automated) and writes an `email_log` row
  (tenant, to, subject, kind, provider id, status). `EMAIL_DEFAULT_DOMAIN` in env,
  documented; unset = current behaviour.
- `tenant_email_domains` per §15.1: create via Resend Domains API, show DNS
  records with copy buttons, `email.verify_domain` job polls every 10 min for
  72 h then marks failed; admin can retry or remove. Resend key absent = the
  section explains the feature is not configured, never a crash.
- Plan limit `maxEmailsPerDay` counted from `email_log`, enforced in `sendEmail`
  for `automated` kind only (transactional always goes out).
- "Enviar por email" on quote, nota de venta and booking detail: sends the
  public link (and PDF attached where one is stored) to the contact's email;
  writes the same timeline activity the WhatsApp send writes, channel `email`.
- Automated emails get an unsubscribe link `/u/[token]` that adds the `optout`
  tag; token = HMAC of contact id, no table.
- Tests: senderFor resolution table, cap enforcement, verify-job state machine.

Exit: a tenant with a mocked verified domain sends from its own address, an
unverified one from the default; unsubscribe sets the tag; lint/typecheck/test/
build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md`. Spawn nothing.
