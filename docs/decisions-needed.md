# Decisions needed from Anton

Questions a build session could not answer for itself, per the autonomy
protocol (`plan-booking.md` §4): the session writes the question here, commits,
and carries on rather than waiting. Answer inline under each item; the phase
that next touches that area picks the answer up.

## Wave 2 planning (§15.10)

1. **The campaign compliance paragraph.** §15.5 said J10 should get a Fable
   spec paragraph before any code. Fable is never spawned by a build session,
   so the rules were written into PLAN.md §15.10 instead ("Campaign compliance
   rules"): templates only, audience resolved at send time, opt-out respected,
   a 7-day per-contact cooldown across all campaigns, paced release through the
   jobs table at a default 20/min, a quality-rating and messaging-limit check
   before each batch, a per-tenant daily cap, and a readable row for every
   send, skip and pause. **Amend or confirm before W2 builds it** — the numbers
   (20/min, 7 days, the daily cap default) are judgement calls, not derived
   from Meta policy.

2. **Contract signature evidence** (§15.7 item 5, still open). Wave 2's W3
   ships click-to-accept and puts the drawn-signature canvas behind a
   per-template flag that is off by default. Confirm that click-to-accept
   alone is what you want to sell, or say that a drawn signature ships on by
   default for some verticals.

3. **Audio transcription provider** (§15.7 item 3, still open). W1 puts
   `transcribeAudio` behind the existing driver seam so either provider fits,
   and follows whatever `AI_DRIVER` is set to. If OpenAI and Gemini differ
   enough in price per minute to matter at volume, pick one and it becomes the
   documented default in `docs/HANDOFF.md`.
