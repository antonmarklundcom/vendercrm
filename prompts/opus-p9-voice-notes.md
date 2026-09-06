# Phase P9 — Voice-note transcription (J6b). OPUS session. Wave 2 lane 1.

Read ONLY: this file, PLAN.md §15.3 (Lane A), §17.0 #5, §17.2 (P9 row and the
conflict list), §17.3 "P9", `prompts/_handoff-w2.md`, `plan-booking.md` §4,
`docs/log/k1.md` (how `generateStructured` was added to both drivers), then
`src/lib/ai/**`, `src/modules/ai/**`, `src/modules/whatsapp/webhook.ts`
(`downloadMedia` and the insert after it), `src/modules/whatsapp/jobs.ts`,
`src/db/schema/ai.ts`, `src/db/schema/whatsapp.ts` (`messages`), the audio
rendering in `src/app/(app)/inbox/[id]/**`, the AI card in `src/app/(app)/settings/**`.

Owns: the P9 row of §17.2. Plus `docs/log/p9.md`.
Hard limits: no edits under `src/modules/memory/**`, `src/modules/setup/**`
(K2), `src/modules/campaigns/**` (P10) or `src/modules/coach/**` (lane 2).
Nothing outbound: reps still type, and the coach half is J8's.

Budget: one session, ≤ 90 min. Branch `phase/p9` off latest main.

Phase rules:
- `AiDriver.transcribe({ audio: Buffer, mimeType, languageHint }) →
  { text, durationSeconds, model, promptTokens?, completionTokens? }` on
  **both** drivers (OpenAI audio transcription; Gemini audio input). Optional
  `AI_AUDIO_DRIVER` (`openai | gemini`, default = `AI_DRIVER`) so audio and
  text may use different providers; `getAudioDriver()` beside `getAiDriver()`.
  Absent keys → null → the job skips with a reason, exactly like `ai_reply`.
- Schema: `messages.transcript` (text, null), `messages.transcribed_at`,
  `messages.transcript_status` (`pending | done | skipped | failed`);
  `ai_replies.kind` gains `transcription` (drizzle-level enum, but the
  migration must widen the column if it is a MySQL ENUM — check 0028's SQL).
  One migration.
- `modules/ai/transcription.ts`: `transcribeMessage(ctx, messageId)` — reads
  the stored object through the storage adapter, refuses over 16 MB or over
  5 minutes (skip, reason on the row), checks the tenant's AI config
  `transcribeAudio` (default true when AI is configured — add it to
  `modules/ai/config.ts` with a safe default resolved at read, K1 pattern),
  counts against the per-tenant daily cap via the existing counters, writes
  the `ai_replies` ledger row (`kind: transcription`, `conversation_id`,
  body = transcript, duration recorded in the prompt/completion fields per
  provider), then sets the columns. Idempotent: a `done` row is never re-run.
- Enqueue: in `webhook.ts`, after a successful `downloadMedia` for
  `type === "audio"`, enqueue `ai.transcribe` (`whatsapp/jobs.ts` or a new
  `ai/jobs.ts` — one job kind, registered in `src/worker/index.ts`). The
  message insert never waits on it.
- `modules/ai/reply.ts`: when building turns, an inbound audio with a
  transcript contributes the transcript as its text; without one it stays as
  today. The `ai_reply` node therefore answers voice notes with no change to
  the engine.
- Inbox: the transcript renders under the audio bubble, greyed while
  `pending`, a short "no se pudo transcribir" for `failed`/`skipped` with the
  reason as a tooltip. Polling (§10 1R #3) picks it up; no new route.
- Settings: one toggle "Transcribir audios" in the AI card.
- Tests: driver unit tests with mocked fetch on both providers (request
  shape, duration/token accounting, an error surfacing as a thrown typed
  error); `transcription.test.ts` — size/duration refusals, cap hit, idempotency,
  `transcribeAudio` off; an integration case: inbound audio webhook → job →
  transcript on the row → `ai_reply` prompt contains the transcript text.
- All strings in es/en/sv; `docs/log/p9.md`; §17.7 index line.

Exit: the integration case above green with MySQL; a message over 5 minutes
is skipped with a reason and spends no tokens; the settings toggle off means
no job runs; lint/typecheck/test/build green; PR merged.

## After this phase
Follow `prompts/_handoff-w2.md`. Next in this session: `prompts/opus-p10-campaigns.md`.
