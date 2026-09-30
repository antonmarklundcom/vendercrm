# Phase R6 — Site leads to paying clients + monthly client reports. SONNET 5.5 session (medium effort).

Read first:
- `PLAN-PROSPECTING.md` §1, §4.2 (R6), §9 and §10.
- `docs/log/r2.md`–`r5.md`.
- Ingest: `src/modules/sites/{ingest,settings,keys}.ts`, `src/modules/leads/submissions.ts`, and every reader of `lead_submissions.contactId` (grep for it).
- Messaging: `src/lib/email/index.ts`, `src/modules/notifications/*`, the `src/modules/whatsapp/` send path.
- PDF: `src/modules/quotes/pdf.tsx`, `src/modules/renderable-document/pdf.tsx`.
- `src/modules/prospecting/**` (agreements, charges).

Branch: `phase/r6-site-leads` off the latest `main`. One PR. Log in `docs/log/r6.md`.

## Hard rules
- **`leadMode` defaults to `crm`, which is today's behaviour.** Every existing ingest test must still pass unchanged.
- **Forward mode** creates no contact and no deal; `lead_submissions.contact_id` becomes nullable.
  - Fix every reader that assumed non-null, and list them in the log.
- **Routing and billing** are pure functions (routing, duplicate window, billable count) with unit tests.
- **Messaging:**
  - Email uses `sendEmail` with kind `automated`.
  - The WhatsApp template path is used only when the tenant has a connected account and an approved template; otherwise it is the manual `wa.me` button. No cold messaging.
  - The `/api/v1/events` endpoint uses the same key, rate-limit and idempotency guards as `/api/v1/leads`.
- **Public report link:** token hashed, 90-day expiry, read-only, no contact data beyond what the client already received.
- **Tables:** one migration, tenant-scoped, isolation tests.
- **i18n:** es/en/sv, parity green.
- **No new GitHub workflow.**

## Exit
Everything in plan §9.6:
- Gates green.
- A real local run: a test lead via the site key → forwarded (email logged) → counted in the month's charge → the PDF renders.
- The browser at 375 px for `/leads-sitios` and the report page.
- `docs/log/r6.md`.
- PR merged.

Then **stop and give Anton the closing report** for the whole R wave: what works, what's left, the monthly cost, and his manual steps. Spawn nothing. Never Fable.
