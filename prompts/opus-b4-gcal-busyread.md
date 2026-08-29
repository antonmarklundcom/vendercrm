# Phase B4 — Google Calendar busy-read. Paste into a fresh OPUS session, ONLY after B3 is merged.

Read `plan-booking.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan-booking §5.4 under the autonomy protocol §4. Busy-READ only — two-way
sync is Backlog; do not build it.

Phase rules:
- Branch `phase/b4` off latest main. B3 unmerged ⇒ finish it first.
- Tokens in `gcal_connections` (schema exists from B1), encrypted with the existing
  AES-GCM helpers (`src/lib/crypto`) exactly like WA tokens.
- `GOOGLE_CLIENT_ID/SECRET` documented in `.env.example`; everything no-ops
  gracefully when unset (Resend pattern) — missing creds never block this phase's
  merge; note the manual step for Anton in §7/§9.
- `slots.ts` stays pure: freebusy is fetched/cached outside and merged into the busy
  input. Short cache + job refresh via existing queue conventions; API failure
  degrades to "no GCal data", never to broken slots.
- Settings UI: connect/disconnect per staff user, status shown.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.4.

Exit: mocked-freebusy tests show GCal-busy windows excluded from slots; disconnect/
expired-token degradation tested; lint/build/tests green; PR merged.

## After this phase — hand off (MODEL SWITCH → Sonnet, fresh session)
Four gates (merged green; exit checklist; pre-handoff audit; §9 entry), then
`create_session` (inherit env + permission mode, never `plan`; model: **Sonnet** —
never Fable) with prompt exactly:
`Read prompts/sonnet-b5-vertical-presets.md in this repo and execute it.`
No `create_session` → STOP and report to Anton that B5 must start in a Sonnet window.
