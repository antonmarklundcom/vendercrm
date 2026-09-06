# Phase W6 — Forms field editor. SONNET session. Wave 2, lane 2, phase 4.

Read ONLY: this file, PLAN.md §15.5 (J11, forms half), §15.10,
`plan-booking.md` §4, `docs/log/p5.md` (custom field definitions — the editor
UI and the definition shape are the pattern you follow), and the code you own:
`src/modules/forms/**`, `src/app/(app)/formularios/**`, the public form
renderer and its submission route. Do not read the rest.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the W6 row of PLAN.md §15.10. Plus `docs/log/w6.md`.

Budget: ≤ 90 min. Branch `phase/w6` off latest main. WIP commit every 30 min.

Phase rules:
- `forms.fields` is already a json column of `FormField`. This phase gives it
  an editor: add, reorder (drag or up/down — up/down is enough), rename,
  required toggle, help text, and the field kinds the type already allows plus
  `select` with options, `checkbox` and `date`. Do not widen the type without
  also widening the public renderer and the validation.
- **Every field kind must round-trip**: editor → stored json → public render →
  submitted value → stored submission → contact/custom-field mapping. A kind
  that renders but cannot be mapped is not done.
- Mapping to a P5 custom field definition is a per-field option, so a form can
  fill `contacts.custom` directly instead of only landing in the submission
  body.
- Validation lives in one zod schema used by both the editor and the public
  POST — never two copies that can disagree.
- Changing a form's fields must not break existing submissions: old rows keep
  rendering with the labels they were submitted under (snapshot the labels on
  the submission, or resolve missing definitions gracefully — pick one and say
  which in the log).
- Spam guard and the existing Turnstile path on the public form stay exactly
  as they are.
- Tests: each field kind's round trip, reordering persistence, a submission
  against a since-edited form, custom-field mapping, and the i18n parity test.

Exit: a form with a select, a checkbox and a date field is built in the
editor, renders publicly, submits, maps one field to a custom field definition
and shows correctly on the contact; an older submission of the same form still
renders; lint/typecheck/test/build green; PR merged; `docs/log/w6.md` + §15.11
line.

## After this phase
Go straight to `prompts/sonnet-w7-companies-merge.md` in the same session.
