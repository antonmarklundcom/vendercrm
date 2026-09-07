# Phase P12 — Embedded signup + multi-number inbox (J9). OPUS session. Owner-started.

**Start this only when Anton says Meta Business verification and Tech Provider
approval have landed** (PLAN.md §17.1 #2). Anton opens this session himself;
it belongs to neither wave 2 lane and can run whenever they are.

Read ONLY: this file, PLAN.md §6.1–§6.2, §15.4, §17.0 #4, §17.2 (P12 row),
§17.3 "P12", `prompts/_handoff-w2.md`, `plan-booking.md` §4, then
`src/modules/whatsapp/accounts.ts`, `graph.ts`, `templates.ts`,
`src/app/(app)/whatsapp/**`, `src/lib/config/env.ts`, `src/middleware.ts`
(PUBLIC routes), and the six `getPrimaryAccount` callers named in §17.0 #4.

Owns: the P12 row of §17.2. Plus `docs/log/p12.md`.
Hard limits: the manual connect path keeps working unchanged; the webhook
route is untouched; `campaigns` (P10) already carries its own account.

Budget: one session, ≤ 90 min. Branch `phase/p12` off latest main.

Phase rules:
- Env: `META_APP_ID`, `META_EMBEDDED_CONFIG_ID` (optional; both absent →
  the "Conectar con Facebook" button does not render and the manual form
  stays as today). `WHATSAPP_APP_SECRET` already exists and is the app secret
  for the code exchange.
- `/whatsapp`: load the Facebook JS SDK, launch Embedded Signup with the
  config id, receive the code + the session-info message (WABA id, phone
  number id), POST both to `POST /api/whatsapp/embedded/exchange`
  (session-guarded, admin only). No CSP exists today; note in the log that
  one added later must allow `connect.facebook.net`.
- `whatsapp/embedded.ts`: exchange the code for a business token
  (`/oauth/access_token`), verify with `debug_token` that it belongs to our
  app and grants the two permissions, register the phone number, subscribe
  the app to the WABA (`POST /{waba-id}/subscribed_apps`), fetch display
  number / verified name, then write the same `wa_accounts` row manual
  connect writes with `connected_via: 'embedded'` and the token encrypted
  (§3.4). Enqueue template sync exactly as manual connect does. Every Graph
  call mocked in tests; the happy path and each failure (bad code, wrong app,
  missing permission, subscribe failure) covered.
- Multi-number: `tenants.settings.defaultWaAccountId` with a picker on
  `/whatsapp` when the tenant has more than one connected account (fallback:
  oldest connected). Replace the six `getPrimaryAccount` callers: where a
  conversation exists use its `wa_account_id`; otherwise the default. Delete
  `getPrimaryAccount` when the last caller is gone (§10 1S precedent: no
  unguarded twin left beside the guarded one). Inbox list shows a number
  chip only when >1 account; the thread header always shows which number.
- The `/whatsapp` connection guide gains an "embedded" tab; §15.4's interim
  partner-sharing text stays out unless `docs/decisions-needed.md` says Anton
  confirmed it against Meta's docs.
- Strings in es/en/sv; `docs/log/p12.md`; §17.7 index line.

Exit: with mocked Graph, the exchange route produces a connected account
identical in shape to manual connect; every former `getPrimaryAccount` path
has a test proving it uses the conversation's account when one exists; a
tenant with two numbers sees the chip and sends from the right one;
lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Stop with the phase report; the live check
(a real number connected through Meta's dialog) is Anton's. Spawn nothing.
