# Phase P6 — Online quote accept, receipts, quote expiry. SONNET session. Lane 2, parallel.

Read ONLY: this file, PLAN.md §8, §15.2 (recibo row), §15.5 (J4 quote accept,
J12 quote expiry), §15.8, `plan-booking.md` §4, `docs/log/p1.md`, then
`src/modules/quotes/**`, `src/modules/documents/**`, `src/modules/renderable-document/**`,
`src/app/(public)/q/**`, `src/app/(app)/quotes/**`.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the P6 row of PLAN.md §15.8. Plus `docs/log/p6.md`.
Hard limits: `quotes/events.ts` and `documents/events.ts` exist from P1 — emit
through them, do not redefine; no crm, inbox, dashboard, email-lib edits
(P4 adds "enviar por email"; you add nothing email-specific).

Budget: one session, ≤ 90 min. Branch `phase/p6` off latest main.

Phase rules:
- Public quote page: "Aceptar" / "Rechazar" (rate-limited like the page itself),
  a typed name, optional comment; writes `quote_acceptances` (quote, decision,
  name, ip, user_agent, at) and sets status; emits `quote.accepted` /
  `quote.rejected` → P1's `quote_accepted` trigger; activity on the timeline;
  a second decision is refused with a clear message; a voided/expired quote
  shows why it can't be accepted. Reopens PLAN §11's deferral on purpose.
- Quote expiry: worker job `quotes.expire` (daily chain like task reminders)
  sets `expired` on `sent` quotes past `validUntil`; expired quotes can be
  duplicated into a new draft from the quote page.
- Recibo: `documents/receipts.ts` renders a receipt from a `document_payments`
  row with `DocumentShell` (number `REC-` from `document_sequences`, own type),
  public token page `/r/[token]` + `/pdf`, "enviar por WhatsApp" reusing
  `sendDocumentOverWhatsapp`, a "Recibo" button beside each payment. Non-fiscal
  notice as on the nota.
- All strings via next-intl; tests beside the module.

Exit: accept flow integration test fires the trigger and blocks a second
decision; expiry job test; receipt PDF snapshot test renders totals with PYG
formatting; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md`. Spawn nothing.
