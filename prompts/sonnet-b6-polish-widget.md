# Phase B6 — Polish: deeplinks, voseo, embeddable widget, QR. Paste into a fresh SONNET session, ONLY after B5 is merged. FINAL PHASE.

Read `plan-booking.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan-booking §6.2 under the autonomy protocol §4.

HARD LIMITS (Sonnet phase): NO schema, auth, slot-logic, or notification-chain
changes. Workaround + Backlog note instead.

Phase rules:
- Branch `phase/b6` off latest main. B5 unmerged ⇒ finish it first.
- wa.me links from normalized `+595…` numbers via `src/lib/phone.ts` — never raw
  user input; add to contact, deal, booking, and inbox views.
- Voseo pass: customer-facing sections of `messages/es.json` + public pages only;
  keep en/sv keys in sync (messages test enforces).
- Widget mirrors the chat-widget pattern (`public/w.js`, `(public)/w/`): `public/b.js`
  + iframe route + snippet in booking-type settings; the iframe route must be in the
  middleware public allowlist ALREADY (`/b/` from B1) — verify, don't re-add.
- QR: generate client-side or with a small lib; PNG + SVG download for the `/b/` URL
  and the tenant wa.me link.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.4.

Exit: widget embeds on a plain HTML test page; QR downloads verified; messages test
green; lint/build/tests green; PR merged.

## After this phase — STOP (do not spawn anything)
Append the final §9 entry, then report to Anton: PRs merged (list), what now works
end-to-end, the §7 human-inputs still pending (Meta template approvals per tenant,
Google OAuth creds, Resend env in prod), exact numbered manual steps, and a pointer
to update the project skill with the new booking/notification architecture.
