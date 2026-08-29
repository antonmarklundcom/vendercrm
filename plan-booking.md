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

### 2026-08-29 — B1 foundation, notifications (branch `claude/vendercrm-booking-plan-5xti3e`)

What now exists:
- `/b/` and `/w/` are in `PUBLIC_PREFIXES`. Both were missing: a customer
  opening the manage link a business sent them got the CRM login page. The
  allowlist is now checked against the `(public)` route-group *directory*
  (`src/middleware.test.ts`), so the next forgotten segment fails a test.
- All of §2's schema, in migration `0025_add_booking_notifications` —
  `booking_notifications`, `booking_type_services`, `gcal_connections`, the
  `booking_types` capacity/deposit/multi-service columns and the `bookings`
  party_size/deposit/services columns, plus `pending_deposit` in the status
  enum. B2–B4 add no schema.
- The delivery chain: `notification-chain.ts` (pure, four branches),
  `notification-templates.ts` (voseo copy + the Meta submission/send
  payloads), `notifications.ts` (the impure walk + the
  `booking_notifications` log), `notification-triggers.ts` (listeners that
  enqueue `booking.notify`). Reminders now run on it and no longer skip in
  silence when the 24h window is shut.
- Per-tenant template submission from `/whatsapp` (`submitTemplate` in
  `whatsapp/templates.ts`, `notification-registration.ts` on top), with each
  template's Meta status on the page.
- Delivery timeline on each row of the upcoming-bookings list, and WhatsApp
  delivery-status webhooks mirrored onto the notification rows.

Decisions / deviations:
- The plan said "booking detail UI (`(app)/booking/[id]`)". That route is the
  booking *type* editor; individual bookings only appear in the upcoming list
  on `/booking`. The timeline went there, as a per-row disclosure. A real
  booking detail page is worth having but is not this phase's job.
- Customer-facing notification copy lives in
  `notification-templates.ts`, not `messages/*.json`. A WhatsApp template is
  a string Meta approved and cannot be localized per viewer; the free-form
  and email rungs must say the same thing or the fallback changes the
  message. Admin-facing strings went into the messages files as usual.
- A reschedule is detected from `rescheduledFromId`, now carried on the
  `booking.created` event, rather than a new event type.
- `tenants.settings.depositInstructions` added (no migration) for the seña
  transfer details B2 will ask for.
- Not verified here, and the first thing the next session should do: this
  environment has no MySQL and no `.env`, so every DB-backed suite skipped
  (19 files already fail at import on missing env — that is the pre-existing
  baseline, unchanged by this phase). `npm run lint`, `npm run build` and all
  non-DB tests are green; `notifications.integration.test.ts` and the
  migration itself have never been run against a real database.

Where B2 should look first: `notifications.ts` (the seña request is already a
kind on the chain), `bookings.ts`'s three double-booking guards and the
`bookings_tenant_active_slot_idx` unique index, which capacity > 1 has to
replace rather than relax.

### 2026-08-29 — B2 capacity, multi-service, señas (same branch, PR #77)

What now exists:
- **Capacity.** The conflict-logic decision, spelled out because it is the
  one a later phase must not undo: capacity is counted per *exact start of
  the same booking type*, and everything else stays a hard overlap block. So
  `slots.ts` gained a `seatsTaken` input separate from `busy` — "the resource
  is unavailable" and "the class is full" are different questions and are now
  different inputs — and `busyAndSeatsFor` splits the one query accordingly.
  At capacity 1 the old path is kept verbatim; the 21 existing slot tests
  pass untouched.
- **The unique index was extended, not relaxed.** `active_slot` gained a seat
  offset (`<resource>:<epoch>#<n>`), computed inside the transaction under
  the existing `booking_resources` row lock. A double-click computes the same
  offset and still collides — the backstop the index exists for survives —
  while N genuine bookings get N distinct keys. Offset 0 renders exactly as
  the old value, so no backfill.
- **Multi-service.** `booking_type_services` CRUD, resolved server-side from
  ids (never trusted from the body), snapshotted onto `bookings.services`.
  The chosen add-ons lengthen the *fit* test while the offered starts stay on
  the type's own increment.
- **Señas.** `pending_deposit` is in `SLOT_HOLDING_STATUSES`, so a hold holds
  the chair; the deposit_request notification goes out instead of a
  confirmation; staff confirm or reject on the booking row; a per-booking
  expiry job plus a stale sweep release it. `expireDeposit` re-reads the
  status, so a job queued two hours ago cannot cancel a booking that has
  since been paid.

Decisions / deviations:
- A reschedule inherits its status: a paid booking stays confirmed, an unpaid
  hold stays pending. Moving a booking must not re-ask for money, and must
  not grant it for free.
- The pure service arithmetic lives in `service-totals.ts` so it is testable
  without env or a database, matching `notification-chain.ts`.
- `partyTooLarge` is a distinct error (422, not 409): no amount of waiting
  makes a party of eight fit a class of six.
- Same limitation as B1: no MySQL in the build environment, so
  `capacity.integration.test.ts` — which is where the index and the hold are
  actually proven — has never run. The pure capacity boundary tests (N-1/N/
  N+1) do run and pass.

Where B3 should look first: `notification-templates.ts` for the send shape,
`whatsapp/send.ts` (interactive messages go next to `sendTemplate`), and
`public.ts`'s `publicReserve` — the WhatsApp booking path must land in the
same transactional reserve, not a second one.

### 2026-08-29 — B3 booking inside WhatsApp (same branch, PR #77)

What now exists:
- `sendInteractive` in `whatsapp/send.ts` — reply buttons for ≤3 options, a
  list beyond that, with Meta's row/title caps enforced before the call
  rather than discovered as a 400. Interactive messages are free-form and so
  carry the same 24h-window guard as text; they are not templates and cannot
  open a conversation.
- `slot-choice.ts` — the row-id wire format (`bk:<typeId>:<epoch>`), pure and
  import-free because it has to survive a round trip through Meta with no
  server-side state.
- `whatsapp-booking.ts` — `offerSlots` and `handleSlotTap`. The tap lands in
  `reserveBooking`: same transaction, same three guards, same capacity
  accounting as the public page. When the slot went while the list sat
  unread, the customer is told in the thread and offered the next ones.
- Three ways to offer: a rep's "Ofrecer horarios" in the inbox, an
  `offer_slots` automation action, and the AI.

Decisions / deviations:
- **The AI booking tool is a text marker, not provider-native tool calls.**
  The plan said "give the drivers a tool-call ability (both OpenAI and Gemini
  drivers)". Instead the model emits `[[SLOTS:<slug>]]`, which is stripped
  before the reply is ever stored, and the system offers the slots. Two
  reasons: the driver interface is prompt-in-string-out, so native tools
  would mean two provider-specific implementations of one idea; and — the
  reason it should stay this way — the model then cannot reserve anything.
  It offers, the customer taps, the tap reserves. "Confirm with the customer
  before reserving" stops being a prompt instruction a model might ignore and
  becomes the shape of the system. Gated per tenant on
  `settings.ai.bookingEnabled`, off by default.
- The marker is stripped at generation, not at send, so a rep approving a
  draft in the inbox sees exactly what the customer will get.
- `handleSlotTap` sends no confirmation of its own: the B1 chain already
  fires on `booking.created`, and for a type with a seña that message is a
  request for money, not a "listo".
- Same limitation as B1/B2: no MySQL here. The wire format, the prompt
  construction and the marker extraction are unit-tested and pass; the
  webhook round trip has not been run against a database.

Where B4 should look first: `bookings.ts`'s `busyAndSeatsFor` — GCal busy
windows merge into the `busy` list it returns, outside `slots.ts`, which
stays pure. `gcal_connections` already exists from B1.

### 2026-08-29 — B4 Google Calendar busy-read (same branch, PR #77)

What now exists:
- `modules/calendar/gcal.ts` — per-user OAuth (offline + consent, so a repeat
  authorization still returns a refresh token), AES-GCM token storage in the
  `gcal_connections` table B1 created, silent refresh, and `busyFromGoogle`.
- `/api/gcal/callback` — compares Google's `state` against the *session's*
  own tenant and user rather than trusting it as identity, so a crafted
  callback cannot attach someone else's calendar to an account.
- Busy windows merge into the list `busyAndSeatsFor` already builds, in
  `bookings.ts`. `slots.ts` never learns Google exists.
- Connect/disconnect in `/settings`, per staff member. `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` in `.env.example`; unset means the section says so
  and slot generation simply has no Google windows.

Decisions / deviations:
- `busyFromGoogle` never throws. A Google outage costs an over-offered slot,
  not a booking page — which is the right trade only because the busy list is
  a union rather than a source of truth, and is why two-way sync stays in the
  backlog.
- A re-authorization that returns no refresh token does not wipe the stored
  one; otherwise "reconnect" would break the connection it was meant to fix.
- Disconnect forgets the row without revoking the Google-side grant: revoking
  needs a live token we may no longer have, and a disconnect button that
  fails when the token has expired is worse than a stale grant.
- No busy-read cache in this phase. Freebusy is one request per connected
  staff member per slot query, which is fine at current volumes; a short
  cache is the obvious first optimisation and is noted in §10.
- The OAuth round trip has not been run against Google — no credentials in
  this environment. The merge behaviour (a Google window closes a slot; an
  empty list changes nothing) is unit-tested and passes.

Next: B5 and B6 are the Sonnet phases — vertical presets, onboarding wizard,
deeplinks, voseo pass, widget and QR. Hard limits in §6 apply: no schema, no
auth, no slot logic, no notification-chain changes.

## §10 Backlog

Payment gateway (Pagopar) for señas; two-way GCal sync; a short cache in
front of the GCal freebusy read (one request per connected staff member per
slot query today); per-slot capacity overrides;
waitlists; SMS fallback channel; per-vertical marketing landing pages; WhatsApp
Flows (native forms) for intake questions.
