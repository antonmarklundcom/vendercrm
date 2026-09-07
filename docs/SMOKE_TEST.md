# Smoke-test checklist

Manual verification to run after every production deploy (PLAN.md §10 1H
#7). Each section maps to a phase's exit criteria — see PLAN.md for the
full context on any item. Use the owner's real tenant/WhatsApp number for
this, not a throwaway one, since 1D's inbound/outbound checks need a real
Meta connection.

## 0. Basics

- [ ] App loads over HTTPS at the production domain
- [ ] Login works with real (non-seed-default) credentials
- [ ] Superadmin console loads (`/superadmin` or equivalent nav entry) for
      the superadmin account

## 1. Core CRM lifecycle (1C exit)

- [ ] Submit the public form at `/f/[tenantSlug]/[formSlug]` for a real
      tenant form
- [ ] A contact is created (or matched by phone, if resubmitting) —
      check Contacts
- [ ] A deal is created on the form's target pipeline/stage
- [ ] Drag the deal across the kanban board — stage change persists on
      reload
- [ ] Contact's timeline shows the form submission and the stage change
- [ ] As a non-admin agent, confirm tenant settings pages are blocked
      (admin-only gate)
- [ ] As an admin, delete a freshly created contact with no history
      (*Datos* → eliminar) — it disappears from `/contacts`. Try the same on
      a contact that already has a quote or a conversation: the button is
      disabled and the page names what is in the way. Same on a deal from
      its detail page (1S)
- [ ] As an agent (not admin), neither page shows the delete section (1S)

## 2. WhatsApp (1D exit)

- [ ] Send an inbound WhatsApp message to the connected number — it
      appears in the Inbox within a few seconds
- [ ] Reply from the Inbox — it's delivered to the real phone
- [ ] Resend/replay the same webhook payload (or wait for Meta's own
      retry) — confirm no duplicate message/timeline entry
- [ ] If safe to test: restart the app mid-conversation, send another
      inbound message — confirm no message is lost

## 3. Multi-site lead ingest API (1E exit)

- [ ] `POST /api/v1/leads` with a valid site API key and a fresh
      `idempotency_key` — returns 201, creates contact + deal
- [ ] Replay the exact same request (same `idempotency_key`) — returns
      200, no duplicate created
- [ ] Request with a wrong/missing API key — returns 401
- [ ] Send far more than the per-site rate limit (60/min) in a burst —
      confirm 429s start appearing
- [ ] Lead is filterable by site/campaign in the Sites UI
- [ ] A site's API key cannot write into another site's pipeline/stage
      (try posting with one site's key, confirm the deal lands only in
      that site's configured routing)

## 4. Quotes (1F exit)

- [ ] Create a quote for a real contact, add at least one catalog item
      and one free-text item
- [ ] Send the quote via WhatsApp — the contact receives a PDF document
- [ ] Open the quote's public link (`/q/[token]`) in a private/incognito
      window — renders without login, shows correct totals/branding
- [ ] Download the PDF from the public link directly — opens correctly
- [ ] Hammer the public quote view or PDF route repeatedly — confirm a
      429 eventually appears (rate limiting, 1H #2)

## 5. Automations (1G exit)

- [ ] Publish a flow using the flagship scenario shape (trigger → wait
      for reply → timeout branch) against a real or test contact
- [ ] Trigger fires (e.g. submit the form the flow listens on) — a run
      appears in the flow's Runs list, `waiting` state
- [ ] Either reply within the window (run advances/completes) or let it
      time out (follow-up branch fires) — confirm the deal stage change
      / follow-up message happens
- [ ] Restart the app while a run is mid-wait — confirm the run resumes
      correctly afterward, not lost or duplicated

## 6. Hardening (1H)

- [ ] `GET /api/cron/tick` with the wrong `x-cron-secret` returns 401;
      with the correct one returns 200
- [ ] `webhook_events` table has rows older than 30 days pruned (check
      after the pruning chain has had time to run once, or trigger it
      manually — see `docs/DEPLOY.md` §5)
- [ ] If Sentry is configured: trigger a deliberate error (e.g. a bad
      route) and confirm it shows up in the Sentry project within a
      couple minutes
- [ ] `.env` / hPanel env vars have no leftover placeholder values
      (`change-me`, empty secrets, etc.)

## 7. Mobile & PWA (§13 H7)

Run this at a 390px-wide viewport — a real phone, or a desktop browser's
device toolbar set to iPhone-class width. The one rule the whole pass is
about: **no page may scroll the body sideways.** A table or the pipeline
board scrolling inside its own container is correct; the page itself
moving is not.

- [ ] Log in, then walk `/dashboard`, `/contacts`, a contact detail,
      `/contacts/import`, `/pipeline`, `/inbox`, `/quotes`, `/documents`,
      `/products`, `/users`, `/settings`, `/sites`, `/automations` — none
      of them scrolls the page sideways
- [ ] On `/pipeline`, press and hold a deal card for about half a second,
      then drag it to another column: the card moves and the column counts
      change. A short tap-and-flick should scroll the board instead — that
      is the TouchSensor's activation delay doing its job
- [ ] Open an automation on the phone: it shows the read-only step list and
      a line saying to edit it on a computer, not the canvas
- [ ] Reply to a conversation in `/inbox` — the composer stays visible with
      the keyboard open
- [ ] "Add to home screen" installs the app: it opens standalone (no
      browser chrome), with the VenderCRM icon and the dark theme colour
- [ ] On the marketing host: `/robots.txt` lists the sitemap and disallows
      `/api/`, `/q/`, `/d/`, `/f/`; `/sitemap.xml` lists the four pages

## 8. Object storage (1K)

Not a click-through — one command, run on the deployed environment (or with
that environment's storage env vars in the shell) so it exercises the driver
production actually uses:

```
npm run smoke-storage
```

It puts a key, reads it back byte-for-byte, signs a URL, proves the signed
URL works, deletes, and confirms the object is gone; non-zero exit on any
failure, and it cleans up its own object even when a step fails.

- [ ] Passes with the environment's configured `STORAGE_DRIVER`
- [ ] On `local`, hammer a signed `/api/storage` URL repeatedly — confirm a
      429 eventually appears (per-IP rate limiting, 1H #2)
- [ ] Re-run after switching `STORAGE_DRIVER=local` → `s3` (the R2 cutover) —
      this is the check that says the bucket and token are right before
      WhatsApp media depends on them

On `s3` the signed URL is absolute and gets fetched over HTTP, so the check
is end-to-end. On `local` it is an app-relative HMAC token served by
`/api/storage`, so the script verifies the token contract (the driver's own
signature verifies; a forged one and an expired one are rejected) and, if
`SMOKE_STORAGE_BASE_URL` is set to a running app's origin, also fetches the
signed URL over HTTP against it — without that variable the HTTP leg is
skipped.

## 9. Wave 1 — automations, push, inbox, email, pipeline, quotes, coach (P1–P7)

- [ ] The bell (top nav) shows unread automation/task/assignment
      notifications; "mark all read" clears the count
- [ ] With `WEB_PUSH_*` set, install the PWA on an Android phone and confirm
      a push arrives with the app closed (see `docs/HANDOFF.md` Part 3.3 —
      needs a real device, not just this checklist)
- [ ] `/inbox/quick-replies` — create one, then insert it from the composer
      in a real conversation; `{{contacto.nombre}}` resolves
- [ ] A conversation note (distinct from a message) appears inline in the
      thread and on the contact's timeline
- [ ] `/inbox?filter=unread` and `?q=` search both narrow the list; web-chat
      rows appear under `all` with a channel chip
- [ ] As admin, add a sending domain on `/settings` and confirm it moves
      pending → verified in Resend (Part 3.3) — then send a quote by email
      and see it arrive from that domain
- [ ] `/contacts/campos` — create a custom field, set it on a contact, and
      confirm it round-trips through CSV export/import and filters the
      contact list
- [ ] On `/pipeline/etapas`, set a stage's "días antes de marcar
      estancado"; a deal left there past that many days shows a stale badge
      on the board
- [ ] Drag a deal on the board — the column's value total and each card's
      days-in-stage update immediately, without a reload
- [ ] Send a quote, open its public link in a private window, and accept it
      — the quote's status flips to accepted and a name/comment is recorded;
      try deciding it a second time and confirm it's refused
- [ ] Record a payment on an issued nota de venta, then "Ver recibo" — the
      public `/r/[token]` receipt view and its PDF both load with no session
- [ ] Set a quote's "válido hasta" in the past and confirm the daily
      `quotes.expire` job (or a manual trigger — `docs/DEPLOY.md` §5) moves
      it to expired; "Duplicar como nuevo borrador" creates a fresh draft
      with the same lines
- [ ] `/dashboard` shows the "Hoy" panel above the stat cards, one row per
      thing needing attention today, each with a working deep link; with
      nothing pending it shows the empty state instead

## 10. Wave 2 lane 2 — contracts, briefing, reports, companies, forms (P13–P17) + K1

- [ ] From a won deal, "generar contrato" creates a contract from a
      template; its public link accepts click-to-accept on a phone, and the
      accepted PDF (with the acceptance record) appears on the contract's
      detail page — `/contracts` lists it and `/contracts/templates`
      manages the templates
- [ ] With AI off, `/dashboard`'s briefing card shows a Monday summary built
      from real numbers (no model call); `/dashboard/briefings/[id]` shows
      the full narrative, and acting on a "Hoy" action records a
      `coach.hoy_action` audit row
- [ ] `/reports` renders funnel, sources, sites, agents, and the response
      distribution for a date range, each with a comparison column vs. the
      previous window; `/api/exports/reports/[table]` CSV matches what the
      page shows for the same filters
- [ ] `/companies` — create a company, link two contacts to it from their
      own pages, and see its contact/open-deal counts; deleting a company
      with contacts still on it is refused
- [ ] `/contacts` shows a "posibles duplicados" panel when two contacts
      share an email or a name + phone prefix; "revisar" opens the merge
      dialog with both contacts preselected; admin-only, and the loser's
      history (deals, tags, custom fields) appears under the winner after
      merging
- [ ] `/forms/[id]` — add a `select` field and map one field to a custom
      field; submit the public form and confirm the mapped answer lands on
      the contact's custom fields; a required field left empty or an
      invalid `select` answer is refused
- [ ] `/settings/negocio` (now in the nav) — fill in the business profile
      and add a fact; the AI reply test (K1) answers using it; the AI
      card's old "Sobre el negocio/Tono/Horario" text fields are gone,
      replaced by a link here

## If anything fails

Don't leave a failing smoke test unresolved before calling a deploy done —
either fix forward or roll back per `docs/DEPLOY.md` §7, then re-run this
checklist before considering the deploy complete.
