# plan-booking.md — VenderCRM → multi-niche, WhatsApp-first booking system (Paraguay)

This plan extends the existing product (see `PLAN.md`, the architecture bible) into a
WhatsApp-first, multi-niche booking system. It follows the phased-autonomous-build
method: one phase = one branch = one PR, merged green before the next phase starts.
Fresh session per phase; the repo (this file §9 + `KNOWN-ISSUES.md`) is the only memory.

| Phase | Model  | Prompt file                          | Covers plan §§ |
|-------|--------|--------------------------------------|----------------|
| B1    | Opus   | `prompts/opus-b1-foundation-notifications.md` | §5.1 |
| B2    | Opus   | `prompts/opus-b2-engine-extensions.md`        | §5.2 |
| B3    | Opus   | `prompts/opus-b3-whatsapp-booking.md`         | §5.3 |
| B4    | Opus   | `prompts/opus-b4-gcal-busyread.md`            | §5.4 |
| B5    | Sonnet | `prompts/sonnet-b5-vertical-presets.md`       | §6.1 |
| B6    | Sonnet | `prompts/sonnet-b6-polish-widget.md`          | §6.2 |

## §1 Decisions already made — do not re-litigate

- WhatsApp is the PRIMARY notification channel; email (Resend) is secondary/fallback.
  Fallback chain for every customer-facing booking notification:
  approved Meta template → free-form WA (only if 24h window open) → email (if address
  captured) → nothing, with the outcome logged and visible on the booking.
- Multi-niche is delivered via per-tenant **vertical presets** (settings JSON +
  seeded data), NOT per-vertical code paths. One codebase, one schema.
- All new schema lands in phase B1, even for features built in B2–B4. Schema is
  never retrofitted.
- Deposits (señas) are **manual-transfer first**: "pending_deposit → confirmed" with
  comprobante sent by WhatsApp and staff confirmation. Payment gateway (Pagopar/
  Bancard) is Backlog, not in this build.
- Google Calendar integration is **busy-read only** in this build; two-way sync is
  Backlog.
- Existing booking engine invariants stay: UTC storage, `America/Asuncion` wall-clock
  via `src/modules/calendar/zoned-time.ts`, pure slot generation in
  `src/modules/booking/slots.ts`, the three double-booking guards in
  `src/modules/booking/bookings.ts`.
- Tenant isolation rules from `PLAN.md` are law: `tenantDb(ctx)`, tenant_id on every
  new table, isolation tests for every new module.
- Customer-facing Spanish copy uses Paraguayan voseo ("Elegí", "Reservá", "Agendá").
  Internal/admin copy may stay neutral. `es` is the reference locale; `en`/`sv` keys
  must stay in sync (`src/i18n/messages.test.ts`).

## §2 Roles & object model

No new roles. New/changed objects (all `char(26)` ULID PKs, `tenant_id`, timestamps,
Drizzle migrations under `src/db/migrations/`):

- `booking_notifications` — log of every attempted customer notification:
  booking_id, kind (confirmation|reminder|cancellation|reschedule|deposit_request|
  review_request), channel (wa_template|wa_freeform|email), status
  (queued|sent|delivered|read|failed|skipped), template name, error, timestamps.
- `booking_types` additions: `capacity` int default 1 (group bookings),
  `deposit_amount` bigint nullable + `deposit_currency` (PYG), `allow_multi_service`
  bool default false.
- `booking_type_services` — optional add-on services per booking type: name,
  extra_duration_minutes, extra_price bigint, sort. Chosen services extend the slot
  duration; stored on the booking as `services` JSON snapshot.
- `bookings` additions: `party_size` int default 1, status gains `pending_deposit`,
  `deposit_confirmed_at`, `deposit_confirmed_by_user_id`, `services` JSON.
- `gcal_connections` — per staff user (tenant-scoped): encrypted OAuth tokens
  (reuse AES-GCM helpers from `src/lib/crypto`), calendar id, sync status,
  last_busy_read_at.
- `TenantSettings` additions (JSON, no migration): `vertical` (slug), plus whatever
  preset bookkeeping B5 needs.

## §3 Feature scope

Core: middleware public-prefix fix; template-based WA notifications with fallback
chain; delivery status on bookings; group capacity; multi-service duration; seña
flow; WhatsApp interactive slot-picker; AI booking tool; GCal busy-read; vertical
presets + onboarding wizard; wa.me deeplinks in CRM; voseo pass; review-request
preset; embeddable booking widget + QR.
Not in scope (Backlog §10): payment gateway, two-way GCal sync, per-vertical custom
code, SIFEN, new marketing pages.

## §4 Autonomy protocol (applies to every phase)

1. Work until the phase's exit criteria pass; never ask permission for in-plan work.
2. One PR per phase: branch `phase/<id>` off latest main; create, watch, and merge
   the PR when green. Never start on top of an unmerged previous phase.
3. Minor non-blocking issues → `KNOWN-ISSUES.md`, keep building.
4. Stop and ask ONLY for: a missing credential with no graceful fallback, or a
   bad-foundation decision (schema shape, money math, slot/conflict logic) where a
   wrong guess forces a rewrite. Otherwise choose reasonably, record it in §9.
5. Missing env values never block: document in `.env.example`, degrade gracefully
   (the Resend no-op pattern in `src/lib/email` is the model).
6. Every phase prompt is re-runnable: check what exists on the branch first,
   continue from the first unmet exit criterion.
7. Sonnet phases (B5, B6): NO schema, auth, slot-logic, or notification-chain
   changes. Workaround + Backlog note instead.
8. Model cost guardrail: Fable/Mythos models are NEVER used for build phases,
   subagents, or spawned sessions. Only Opus and Sonnet, per the phase table. If a
   session thinks it needs Fable, it stops and asks Anton first.
9. Phase handoff — only when four gates pass: PR merged green; exit checklist
   passed; pre-handoff audit done (re-run `npm run build` + `npm test`, adversarially
   re-read the merged diff, fix findings); §9 build-log entry committed. Then spawn
   the next phase as a NEW session via claude-code-remote `create_session`: inherit
   environment and permission mode (never `plan`), set `model` per the phase table,
   prompt exactly `Read prompts/<next-file>.md in this repo and execute it.`
   Fallback without `create_session`: same window if same model; stop and report at
   a model switch.
10. Build log: before merging, append a 5–10 line dated entry to §9 — phase id + PR,
    what now exists, decisions/deviations, where the next phase should look first.

Validation bar for every phase: `npm run lint`, `npm run build`, `npm test` green
locally before pushing; new modules get isolation tests; slot/notification logic
gets unit tests next to the 21 existing slot tests.

## §5 Opus phases

### §5.1 B1 — Foundation: middleware fix, full schema, WA-first notifications

1. **Middleware fix**: add `/b/` and `/w/` to `PUBLIC_PREFIXES` in
   `src/middleware.ts`; extend the allowlist unit test so a missing public prefix
   fails a test, not production.
2. **All schema from §2** in one migration set, including columns B2–B4 will use.
3. **Notification layer** (`src/modules/booking/notifications.ts` + job handlers):
   - Template definitions for `booking_confirmation`, `booking_reminder`,
     `booking_cancelled`, `booking_rescheduled`, `booking_deposit_request`
     (es_PY? use `es` language code Meta accepts; voseo body copy; variables: contact
     name, business name, service, local date/time, manage link `/b/g/<token>`).
     Add a "submit to Meta" admin action via the existing template sync module
     (`src/modules/whatsapp/templates.ts`) so each tenant's WABA can get them
     approved; store per-tenant template status.
   - Fallback chain per §1, implemented once and used by every kind. Rework
     `src/modules/booking/reminders.ts` onto it (today it silently skips when the
     24h window is closed — that behavior goes away).
   - Confirmation sends immediately on `booking.created`; cancellation/reschedule
     notifications on their events; email templates (Resend) for all kinds as the
     secondary channel; every attempt logged to `booking_notifications`.
   - Booking detail UI (`(app)/booking/[id]`): delivery status timeline.
4. Exit: middleware test green; migrations apply on a fresh DB; notification unit
   tests cover chain selection (template approved / window open / email only /
   nothing) ; reminder job no longer skips silently; build+tests green; PR merged.

### §5.2 B2 — Engine extensions: capacity, multi-service, señas

1. **Capacity**: slot generation counts confirmed+pending party_size per slot
   against `booking_types.capacity`; overlap guards updated so N concurrent
   bookings are allowed up to capacity (the unique `active_slot` index must be
   relaxed/replaced for capacity>1 — design carefully, this is the conflict-logic
   heart). Public page asks party size when capacity > 1.
2. **Multi-service**: public page offers `booking_type_services` checkboxes;
   chosen services extend duration used for slot search and the calendar event;
   snapshot onto `bookings.services`.
3. **Seña flow**: when `deposit_amount` set → booking lands as `pending_deposit`;
   deposit_request notification (chain from B1) with amount + transfer instructions
   (per-tenant text in settings); staff confirm/reject on booking detail; confirm →
   `confirmed` + confirmation notification; auto-expire unconfirmed after a
   configurable cutoff (job) releasing the slot.
4. Exit: unit tests — capacity boundary (N-1/N/N+1), multi-service duration math,
   pending_deposit does/doesn't hold slots per design, expiry job; existing 21 slot
   tests still green; build+tests green; PR merged.

### §5.3 B3 — Booking inside WhatsApp

1. **Interactive slot-picker**: extend `src/modules/whatsapp/send.ts` with Cloud API
   interactive list/button messages. A staff action ("Ofrecer horarios" from inbox/
   contact) and an automation action send the next available slots for a chosen
   booking type; the customer's tap reserves via the existing `publicReserve` path
   (webhook handles the interactive reply); confirmation via B1 chain.
2. **AI booking tool**: give `src/modules/ai/` a tool-call ability (both OpenAI and
   Gemini drivers) to query slots and reserve, gated per tenant
   (`ai.bookingEnabled`), always confirming with the customer before reserving,
   handing off to a human on ambiguity (existing handoff keyword mechanics).
3. Exit: webhook round-trip test with a faked interactive reply creates a booking;
   AI tool covered by unit tests with a mocked driver; double-booking guards proven
   to hold on the WA path (same transactional reserve); build+tests green; PR merged.

### §5.4 B4 — Google Calendar busy-read

1. Google OAuth (per staff user) storing tokens in `gcal_connections`; settings UI
   to connect/disconnect; env vars `GOOGLE_CLIENT_ID/SECRET` in `.env.example`,
   feature no-ops gracefully when unset.
2. Busy-read: freebusy fetched for assigned resources' connected calendars during
   slot generation (short cache; job-refreshed) and merged into the busy list that
   `slots.ts` already consumes — keep `slots.ts` pure, fetch outside it.
3. Exit: slot generation excludes GCal-busy windows in tests (mocked freebusy);
   disconnect/expiry degrades to no-GCal without breaking slots; build+tests green;
   PR merged. This is the last Opus phase → handoff footer switches model to Sonnet.

## §6 Sonnet phases

Hard limits: no schema/auth/slot-logic/notification-chain changes; data access
through existing modules only.

### §6.1 B5 — Vertical presets + onboarding wizard

1. Preset catalog in code (`src/modules/tenancy/verticals.ts`): barbería/salón,
   clínica/consultorio, taller mecánico, gimnasio/clases, profesionales (abogados/
   contadores), genérico. Each seeds: booking types (durations, buffers, capacity,
   services, questions, location_mode), resources, availability incl. siesta split,
   pipeline stages, tags, and automation flows (no-show reactivation; post-completed
   review request using `send_review_request` + tenant `reviewLink`).
2. Onboarding wizard (`(app)` first-run + settings entry): pick rubro → preview →
   apply preset → connect WhatsApp pointer → share `/b/` link. Store `vertical` in
   TenantSettings. Applying is additive and idempotent; never deletes tenant data.
3. Exit: applying each preset on a fresh demo tenant yields a working public booking
   page; i18n keys in es (voseo)/en/sv, messages test green; build+tests green; PR
   merged.

### §6.2 B6 — Polish: deeplinks, voseo, widget, QR

1. wa.me deeplinks (normalized `+595…` via `src/lib/phone.ts`) on contact, deal,
   booking, and inbox views.
2. Voseo pass over customer-facing `messages/es.json` sections and public pages
   (booking, forms, quote/document views, notification copy).
3. Embeddable booking widget: `public/b.js` loader + iframe route (mirror the chat
   widget pattern `public/w.js` / `(public)/w/`), snippet shown in booking-type
   settings.
4. QR generator on booking-type page: downloadable QR (PNG/SVG) for the `/b/` URL
   and the tenant's wa.me link.
5. Exit: widget embeds on a plain HTML test page; QR downloads work; messages test
   green; build+tests green; PR merged. Final phase → STOP footer report.

## §7 Human-inputs checklist (Anton)

- [ ] B1: nothing new to build — but per-tenant Meta **template approval** must be
  triggered from the UI and approved by Meta before templates actually send (chain
  falls back to email until then). Resend env vars must be set in production for the
  fallback to exist.
- [ ] B4: Google Cloud project + OAuth client (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, redirect URI on the crm domain).
- [ ] B6/live: real tenant `reviewLink`s and WhatsApp numbers for demo tenants.

## §8 Open business questions (parked)

Pricing of booking-only tier; Pagopar/Bancard gateway timing; which verticals to
market first; whether señas should be plan-gated.

## §9 Build log & handoff

(append entries here — newest last)

## §10 Backlog

Payment gateway (Pagopar) for señas; two-way GCal sync; per-slot capacity overrides;
waitlists; SMS fallback channel; per-vertical marketing landing pages; WhatsApp
Flows (native forms) for intake questions.
