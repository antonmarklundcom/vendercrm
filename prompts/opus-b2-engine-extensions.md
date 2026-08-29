# Phase B2 — Engine extensions: capacity, multi-service, señas. Paste into a fresh OPUS session, ONLY after B1 is merged.

Read `plan-booking.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Read `docs/SPEC-BOOKING.md`, `src/modules/booking/slots.ts` and `bookings.ts` before
changing anything. Execute plan-booking §5.2 under the autonomy protocol §4.

Phase rules:
- Branch `phase/b2` off latest main. B1 unmerged ⇒ finish it first.
- Load skills: `paraguay-business-apps` (guaraní integer amounts for deposits).
- The unique `active_slot` index is today's last-line double-booking guard; replacing
  it for capacity>1 is the bad-foundation decision of this phase — design it, write
  the invariant down in §9, and prove it with concurrent-reserve tests before
  building UI on top.
- `slots.ts` stays pure (no DB/clock): capacity counting and service-extended
  durations enter through its inputs.
- Seña texts (transfer instructions) are per-tenant settings; amounts integer ₲
  formatted `₲ 1.234.567`; expiry job uses the existing jobs/queue conventions.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.4.

Exit: capacity boundary tests (N-1/N/N+1) green; multi-service duration math tested;
pending_deposit hold + expiry-release tested; all 21 pre-existing slot tests green;
public page handles party size + services; lint/build/tests green; PR merged.

## After this phase — hand off (fresh session)
Four gates (merged green; exit checklist; pre-handoff audit; §9 entry), then
`create_session` (inherit env + permission mode, never `plan`; model: Opus — never
Fable) with prompt exactly:
`Read prompts/opus-b3-whatsapp-booking.md in this repo and execute it.`
No `create_session` → continue in this window (same model).
