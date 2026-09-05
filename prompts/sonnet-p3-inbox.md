# Phase P3 — Inbox ergonomics. SONNET session. Lane 2, parallel with P4–P7.

Read ONLY: this file, PLAN.md §15.5 (J2 inbox half, J12 "opt-out on manual sends"),
§15.8, §6.5, `plan-booking.md` §4, `docs/log/p1.md`, `docs/log/p2.md`, then
`src/modules/whatsapp/inbox.ts`, `src/app/(app)/inbox/**`, `src/app/api/inbox/**`.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the P3 row of PLAN.md §15.8. Plus `docs/log/p3.md`.
Hard limits: no schema changes outside two additive tables (`quick_replies`,
`conversation_notes`) and one column `conversations.channel` if P1/P2 did not
add it; no changes to `send.ts` window logic, automations, crm, quotes, dashboard.

Budget: one session, ≤ 90 min. Branch `phase/p3` off latest main.

Phase rules:
- Quick replies: tenant-level, name + body with `{{contacto.nombre}}` variables,
  admin manages in settings, `/` in the composer opens a picker; sends go
  through the existing `sendText` (window rules untouched).
- Internal notes: a note row rendered inline in the thread in a distinct style,
  never sent, author + time, shown on the contact timeline too.
- List filters as URL params: `mine`, `unassigned`, `unread`, `all`; web-chat
  conversations appear in the same list with a channel chip and open their
  existing `/chat/[id]` page (do not merge the two data models in this pass).
- Message search: `/inbox?q=` matching message body and contact name/phone,
  LIKE with a limit, scoped by `tenantDb`.
- Manual send to a contact tagged `optout` shows a confirm dialog naming the
  tag; the confirmation is logged as an activity.
- Mark as unread; keyboard: `j/k` next/prev, `r` reply focus.
- All strings via next-intl in the three locales; tests beside the module.

Exit: filters and search covered by integration tests; quick reply with a
variable renders the contact name; note never produces a `messages` row;
opt-out confirm covered; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md`. Spawn nothing.
