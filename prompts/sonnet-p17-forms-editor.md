# Phase P17 — Forms field editor (J11b). SONNET session. Wave 2 lane 2.

Read ONLY: this file, PLAN.md §4 (forms), §5 (public form behavior), §17.3
"P15 / P17" (P17 half), §17.2 (P17 row), `prompts/_handoff-w2.md`,
`plan-booking.md` §4, `docs/log/p5.md` (custom fields), then
`src/modules/forms/**`, `src/app/(app)/forms/**`, `src/app/(public)/f/**`,
`src/db/schema/forms.ts`, `src/db/schema/crm.ts` (`customFieldDefinitions`,
and whether `contacts.wa_marketing_consent_at` exists on `main`).

Owns: the P17 row of §17.2. Plus `docs/log/p17.md`.
Hard limits: no schema (`forms.fields` is JSON); the ingest engine
(`recordLeadSubmission`) is called, not changed; honeypot and Turnstile
behavior unchanged.

Budget: one session, ≤ 90 min. Branch `phase/p17` off latest main.

Phase rules:
- Field definition zod: `{ key, label, type, required, options?, mapTo? }`
  with `type` in text/phone/email/select/textarea (§4) + `checkbox` + `date`;
  `key` slugified and immutable once submissions exist (P5's rule for custom
  fields); `mapTo` = a P5 custom-field key, validated against the tenant's
  definitions. `phone` stays mandatory and unique in every form (it is
  contact identity, §5).
- Editor on `/forms/[id]`: add, remove, reorder (buttons, no DnD library),
  edit label/required/options/mapTo, `useActionState`-shaped, server-validated.
  Existing forms with `STANDARD_FIELDS` open in the editor unchanged.
- Public page renders from the definitions; submission validates against
  them server-side; mapped values are written into `contacts.custom` through
  the same path the contact form uses; unmapped answers stay in the
  submission payload as today.
- Consent: a `checkbox` with key `consent_whatsapp`, when ticked, sets
  `contacts.wa_marketing_consent_at` with `source: form` — **only if that
  column exists on `main`** (P10). If it does not, the checkbox type still
  ships and the consent write is a one-line `KNOWN-ISSUES.md` entry.
- Tests: definition zod (immutable key, mapTo validation, phone mandatory);
  public submission against a custom definition set (required enforced,
  select option enforced, mapped value lands in `custom`, consent stamped
  when the column exists).

Exit: a tenant builds a five-field form with a select and a mapped custom
field, a submission lands with the mapped value on the contact; lint/
typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Next in this session:
`prompts/sonnet-k3-memory-imports.md` if PLAN.md §16.8 shows K2 merged,
otherwise skip K3 (log it in `KNOWN-ISSUES.md`) and go to
`prompts/sonnet-p18-link-pass.md`.
