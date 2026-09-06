# Phase W1 — WhatsApp voice notes, transcribed. OPUS session. Wave 2, lane 1.

Read ONLY: this file, PLAN.md §15.3 (Voice, Lane A), §15.5 (J6b), §15.10
table and conventions, `plan-booking.md` §4 (autonomy protocol),
`docs/HANDOFF.md` Part 2A conventions, `docs/log/p3.md` (inbox) and
`docs/log/p7.md` (Hoy panel). Then the code you own: `src/lib/ai/**`,
`src/modules/whatsapp/webhook.ts`, `inbox.ts`, `jobs.ts`,
`src/db/schema/whatsapp.ts`, `src/modules/coach/**`, `src/lib/storage`,
`src/worker/**`. Do not read the rest.
Execute under the autonomy protocol. Build nothing outside the plan.

Owns: see the W1 row of PLAN.md §15.10. Plus `docs/log/w1.md`.

Budget: one session, ≤ 90 min of work. Branch `phase/w1` off latest main.
WIP commit every 30 min. Open the PR the turn the exit criteria pass.

Phase rules:
- **Driver seam first.** Add `transcribeAudio({ bytes, mimeType, languageHint })`
  to the `AiDriver` interface in `src/lib/ai/types.ts` and implement it on both
  drivers (OpenAI and Gemini audio). It returns `{ text, model, promptTokens,
  completionTokens }` like the other calls, so the existing `ai_replies` ledger
  and the per-tenant daily caps meter it with no new accounting. `AI_DRIVER=none`
  means the feature is absent, never a crash — the same skip-with-reason shape
  `ai_reply` already uses.
- **Storage, not re-download.** Inbound audio already lands in R2 as
  `whatsapp-media/<tenant>/<mediaId>` (`webhook.ts` → `downloadMedia`).
  Transcription reads that key. Never re-fetch from the Graph API — the media
  URL expires and the bytes are already paid for.
- **Columns** on `whatsapp_messages`: `transcript` (text, null), `transcript_status`
  (`pending|done|failed|skipped`, null for non-audio), `transcript_model`,
  `transcript_at`. One additive migration, no backfill of old audios.
- **Job kind `whatsapp.transcribe`** (tenant, messageId), enqueued from the
  webhook when an inbound message is `audio` and a driver is configured;
  drained by the worker; a failure retries on the existing backoff and lands
  `failed` with the reason in the step log rather than poisoning the queue.
  Cap: audio longer than 10 minutes or larger than 16 MB is `skipped` with a
  reason, not attempted.
- **Inbox**: the audio bubble shows the transcript under the player, in a
  quieter type than the message body, with a `pending` shimmer and a
  `failed`/`skipped` line that says why. The transcript is searchable by the
  existing P3 message search (it is a column on the row the search already
  reads — check, do not assume).
- **AI auto-reply answers voice notes.** Wherever the auto-reply chain reads
  `message.body`, an audio message with a `done` transcript contributes that
  transcript instead of an empty string. A `pending` transcript defers the
  reply rather than replying to nothing — re-enqueue behind the transcription.
- **Coach half.** `src/modules/coach/voice.ts`: a voice note from the tenant's
  own owner number, transcribed, matching a short intent list ("hoy", "qué
  tengo", "pendientes"), replies with the same L1 list the "Hoy" panel computes
  (`src/modules/coach/hoy.ts` — reuse it, do not re-derive the ranking).
  Anything not matching is left alone; this is not a chatbot.
- Tests beside the module: driver contract test with a stubbed HTTP layer, job
  handler happy path / failure / skip-too-long, the auto-reply defer, the coach
  intent match, and the schema/i18n parity test still green.
- Do not touch campaigns, contracts, reports, forms or the pipeline.
- Re-runnable; minor issues → `docs/log/w1.md`; stop only per protocol §4.4.

Exit: an inbound audio message with a driver configured produces a `done`
transcript row in the integration suite and renders under the bubble; with
`AI_DRIVER=none` nothing is enqueued and nothing throws; an auto-reply to a
voice note quotes the transcribed text; a coach voice note returns the Hoy
list; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-p.md` and go straight to the next phase of
`prompts/opus-wave2-lane1.md`: `prompts/opus-w2-campaigns.md`, same session,
model Opus. Do not stop to report.
