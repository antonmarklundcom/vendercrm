# Phase P13 — Contracts (J5). SONNET session. Wave 2 lane 2.

Read ONLY: this file, PLAN.md §15.2 (the contracts paragraph), §17.1 #5,
§17.3 "P13", §17.2 (P13 row), `prompts/_handoff-w2.md`, `plan-booking.md` §4,
`docs/log/p1.md` (events → triggers pattern), `docs/log/p6.md` (how `recibo`
widened `NumberedDocumentType`), then `src/modules/documents/` (numbering,
delivery, types, `receipt-pdf.tsx`), `src/modules/renderable-document/**`,
`src/modules/quotes/public.ts` (`decideQuote` — the acceptance shape to
mirror), `src/modules/automations/triggers.ts`, the variable renderer used by
`automations/actions.ts`, `src/lib/http/client-ip.ts`, `src/app/(public)/q/**`.

Owns: the P13 row of §17.2. Plus `docs/log/p13.md`.
Hard limits: no fiscal fields anywhere (the `schema/documents.ts` boundary
comment applies to `contracts` too); no Markdown/HTML library — bodies are
plain text; one listener line in `automations/triggers.ts`, nothing else there.

Budget: one session, ≤ 90 min. Branch `phase/p13` off latest main.

Phase rules:
- Schema `src/db/schema/contracts.ts`: `contract_templates` (tenant, name,
  body text, is_active), `contracts` (tenant, template_id, template_snapshot
  text, contact_id, deal_id?, quote_id?, number `CON-`, rendered_body, status
  `draft | sent | accepted | declined | voided`, public_token hash, pdf_storage_key,
  signed_pdf_storage_key, sent_at, decided_at), `contract_acceptances`
  (contract_id unique, name_typed, decision `accepted | declined`, ip,
  user_agent, pdf_sha256, signature_storage_key null — the drawn-signature
  column exists, no pad is built). One migration. Numbering through
  `document_sequences` with `NumberedDocumentType` +`contrato`, prefix `CON`.
- Body rendering (`modules/contracts/render.ts`, pure): lines starting `#`
  are headings, blank lines separate paragraphs, `{{contacto.*}}` /
  `{{negocio.*}}` resolve through the flow variable registry as it exists on
  `main`; an unknown variable is refused at template save with its name.
  Three vertical presets seeded as templates on first visit to `/contracts`
  (contrato de servicio, reserva de inmueble, orden de trabajo — Spanish,
  generic, no legal claims beyond the firma-electrónica-simple line).
- Lifecycle: draft (editable) → send (freeze `rendered_body`, render PDF with
  its own react-pdf layout — prose, not `DocumentShell` — via
  `storeDocumentPdf`, deliver by WhatsApp through `sendDocumentOverWhatsapp`
  and by email through `sendEmail`, timeline activity) → the public page
  `/c/[token]` shows the text and the PDF, one line stating it is a *firma
  electrónica simple* under Ley 4017/2010, and a name field + accept/decline
  (rate-limited by IP like `decideQuote`, unique index the real guard) →
  acceptance stores the evidence with the SHA-256 of the PDF bytes served,
  re-renders a PDF with an appended acceptance page under
  `signed_pdf_storage_key`, emits `contract.accepted` → `contract_accepted`
  trigger (closes the `KNOWN-ISSUES.md` line), writes the activity. Void is
  admin-only + audit; a voided token stops resolving.
- UI: `/contracts` list + `/contracts/templates` editor, `/contracts/[id]`
  detail with send/void/copy link, "generar contrato" on deal and quote detail,
  a "Contratos" tab on `contacts/[id]`. Nav entry is P18's.
- Tests: `render.test.ts` (headings, paragraphs, variables, unknown refused);
  `contracts.integration.test.ts` — the full lifecycle, second decision
  refused, the trigger fires into the automation queue, the served-PDF hash
  matches what was stored, cross-tenant isolation on every service and both
  public routes.

Exit: §15.5 J5's exit ("a service contract generated from a won deal,
accepted on a phone, PDF with the acceptance record in storage, deal moved
by the trigger") green in the integration suite; lint/typecheck/test/build
green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Next in this session: `prompts/sonnet-p14-briefing.md`.
