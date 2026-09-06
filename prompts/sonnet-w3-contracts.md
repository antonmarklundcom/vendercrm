# Phase W3 — Contracts with click-to-accept. SONNET session. Wave 2, lane 2, phase 1.

Read ONLY: this file, PLAN.md §15.2 (the document family and the **Contracts
(J5) — the shape** paragraph, which is the spec), §15.5 (J5), §15.10 table and
conventions, `plan-booking.md` §4, `docs/log/p6.md` (quote accept + receipts —
the public-token page, the PDF path and the acceptance record are the pattern
you copy), and the code you own or must match: `src/modules/quotes/**`,
`src/modules/documents/receipts.ts`, `src/modules/renderable-document/**`,
`src/app/(public)/q/**`, `src/db/schema/documents.ts` (its boundary comment),
`src/lib/storage`, `src/modules/automations/triggers.ts`. Do not read the rest.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the W3 row of PLAN.md §15.10. Plus `docs/log/w3.md`.

Budget: ≤ 90 min. Branch `phase/w3` off latest main. WIP commit every 30 min.

Phase rules:
- A contract is **non-fiscal**: it obeys the `schema/documents.ts` boundary
  comment (no timbrado, no CDC, no fiscal numbering) and lives in its own
  module rather than inside `documents`.
- Tables exactly as §15.2 names them: `contract_templates` (tenant, name, body
  Markdown with `{{contacto.nombre}}`-style variables, ordered clauses),
  `contracts` (tenant, template snapshot, contact, deal?, quote?, rendered
  body, status `draft|sent|accepted|declined|voided`, `public_token`,
  `pdf_storage_key`), `contract_acceptances` (name typed, timestamp, IP, user
  agent, SHA-256 of the PDF shown, optional drawn-signature PNG key). One
  additive migration.
- **Template snapshot, not a live reference**: editing a template never
  changes a contract already sent. Store the rendered body on the row.
- Public page `/c/[token]`: the rendered contract, a name field, a check box,
  an accept and a decline button. It must say in one line that this is a
  *firma electrónica simple* under Ley 4017/2010 — evidentiary, not the
  certified *firma digital* — and must not imply a notarised signature. Same
  rate limit and token shape as the P6 quote page.
- Drawn signature is **optional and off by default** (§15.7 item 5 is still
  open): click-to-accept is the shipped path; if you build the canvas at all
  it is behind a per-template flag, and if the acceptance evidence question
  turns out to need a legal answer, put it in `docs/decisions-needed.md` and
  ship click-to-accept.
- Acceptance: writes the evidence row, renders and stores the PDF, fires the
  existing `contract_accepted` trigger (P1 declared the type and left no
  emitter — this phase is the emitter; remove that item from `KNOWN-ISSUES.md`
  only in W8's link pass, not here), and can move the deal via a flow.
- Vertical presets ship one template each: contrato de servicio, reserva de
  inmueble, orden de trabajo. Seeded like the other vertical presets, not
  hard-coded in the UI.
- App pages `/contratos`: list, create from a deal or quote (pre-filling the
  variables from that record), send by WhatsApp or email (reuse P4's
  `senderFor(ctx)` and the existing template send — do not write a new
  channel), and a detail page showing the acceptance evidence.
- Tests beside the module: variable rendering, snapshot immutability, the
  public accept flow end to end (accept → evidence row → PDF key → trigger
  fired), decline, an already-accepted token being idempotent, and the i18n
  parity test.

Exit: a service contract generated from a won deal, accepted on a phone-width
page, produces a PDF with the acceptance record in storage and fires
`contract_accepted`, all green in the integration suite;
lint/typecheck/test/build green; PR merged; `docs/log/w3.md` + §15.11 line.

## After this phase
Go straight to `prompts/sonnet-w4-weekly-briefing.md` in the same session.
