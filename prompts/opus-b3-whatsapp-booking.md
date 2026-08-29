# Phase B3 — Booking inside WhatsApp: interactive slot-picker + AI tool. Paste into a fresh OPUS session, ONLY after B2 is merged.

Read `plan-booking.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Read `src/modules/whatsapp/{send,webhook,inbox}.ts` and `src/modules/ai/` before
coding. Execute plan-booking §5.3 under the autonomy protocol §4.

Phase rules:
- Branch `phase/b3` off latest main. B2 unmerged ⇒ finish it first.
- Load skills: `paraguay-business-apps`; `claude-api` is NOT needed — the AI module
  uses the existing OpenAI/Gemini drivers, extend those.
- All WA reservations go through the same transactional reserve path
  (`publicReserve`/`reserve`) — never a parallel write path; the B2 capacity
  invariants must hold under the webhook path too.
- Interactive messages: respect the 24h window (they are free-form); when closed,
  the staff action explains why and offers the template/email alternative from B1.
- AI tool: per-tenant `ai.bookingEnabled` gate, explicit customer confirmation
  before reserving, human handoff on ambiguity; respect existing spend caps.
- Voseo Spanish in all customer-visible strings; i18n keys in sync (es/en/sv).
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.4.

Exit: faked interactive-reply webhook test creates a booking end-to-end; concurrent
WA + web reserve test shows no double-booking; AI tool unit-tested with mocked
driver; lint/build/tests green; PR merged.

## After this phase — hand off (fresh session)
Four gates (merged green; exit checklist; pre-handoff audit; §9 entry), then
`create_session` (inherit env + permission mode, never `plan`; model: Opus — never
Fable) with prompt exactly:
`Read prompts/opus-b4-gcal-busyread.md in this repo and execute it.`
No `create_session` → continue in this window (same model).
