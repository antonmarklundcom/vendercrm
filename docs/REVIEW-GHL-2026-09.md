# VenderCRM contra GoHighLevel

> Competitive review and build plan, 2026-09-05. The live page: https://claude.ai/code/artifact/6a22c78c-246d-43c7-a706-27f136538003


Where a WhatsApp-first CRM for Paraguayan SMBs is behind the category leader, where it is already ahead, and the ranked list of moves that make it better than GHL for this market rather than merely comparable.

Repo antonmarklundcom/vendercrm, main at PR #90, 2026-09-05. 90 test files, 3 locales, 1 994 keys each.

**Baseline corrections before the comparison.** Four things in the brief's "already exists" list are thinner in the code than described.

- **SIFEN e-invoicing is not built.** `modules/sifen/` holds the módulo-11 check digit, the 44-digit CDC composer, three code tables, and a facade whose six functions each throw `SifenNotImplementedError`. No `sifen_*` tables, no XML, no signing, no SET submission, no KuDE. PLAN §9 says Phase 2 is blocked on a `PLAN-SIFEN.md` that does not exist. Documents ship only as `nota_venta` with a "sin validez tributaria" notice.
- **Custom fields have no UI.** `contacts.custom` is a JSON column nobody reads or writes (schema `crm.ts:79`).
- **Embedded signup is not wired.** Tenants connect WhatsApp by pasting a WABA id, phone-number id and token (`whatsapp/accounts.ts:20-47`).
- **Five trigger types have no label.** `booking_created/cancelled/no_show/completed` and `chat_lead_captured` are in `TRIGGER_TYPES` and the create-flow dropdown, but `messages/*.json` only names six triggers (`es.json:1097-1104`). A real bug, small.


## 1. Feature by feature **critical****meaningful****cosmetic****ahead of GHL**

Severity is from the perspective of a Paraguayan clinic, constructora, inmobiliaria or professional firm evaluating VenderCRM after having seen or used GHL. "Ahead" means GHL cannot easily match it for this market, not that GHL lacks the feature.

| Area | VenderCRM today (from code) | What GHL offers | Gap |
|---|---|---|---|
| Pipeline & deals | Multiple pipelines, drag-drop board (dnd-kit), deal value + currency, owner, won/lost as stage flags with a free-text close reason, reopen, stage-change event fires automations, deal tasks, linked quotes and notas de venta, multiple deals per contact. Missing: value total per column, probability or weighted forecast, expected close date, stale-deal indicator (`stageEnteredAt` exists, nothing reads it), in-column ordering is append-only, distinct lost reason. | Same board mechanics plus opportunity value per stage header, win probability, expected close, "rotting" days-in-stage, lost reason picklists, stage entry/exit automation, opportunity value-changed triggers. | **meaningful** — column totals + stale badge are the two people notice |
| Contacts | Phone is identity (unique per tenant). Tags, tenant-shared saved views over search/tag/owner/source/pipeline/stage/open-deal/date, CSV import with header guessing and phone dedupe (update or skip), export of the current filter, bulk tag/assign/add-to-pipeline/delete, ⌘K search across five entities, first-touch UTM stamped once, tasks with email-only reminders, unified timeline (notes, calls, stage moves, forms, quotes, documents, messages, leads). Missing: custom field definitions + UI, company/organization entity, merge, email dedupe, a do-not-contact flag (opt-out tag is only honoured by automations and AI, not by a rep typing in the inbox), lead scoring. Contact list pagination is done in memory after loading every row (`contact-list.ts:67-153`). | Unlimited custom fields with folders, companies, smart lists with any field, merge duplicates, DND per channel, lead scoring (newer), bulk SMS/email from a list. | **critical** — custom fields; the rest meaningful |
| Automations | 11 triggers, 4 conditions, 10 actions, `wait_duration` and `wait_for_reply` with a timeout branch, yes/no branching on conditions, cycle-free DAG validation, durable runs that resume at the in-flight node, reply-vs-timeout race resolved by compare-and-set, one live run per flow+contact, keyword opt-out honoured by every send, AI reply as a node, review request and slot-offer actions. Missing: triggers for quote sent, document sent, payment recorded, deal won/lost as explicit types, task overdue, inbound generic webhook; actions for create task, notify a user, send email, outbound webhook; conditions on contact field, deal value, source or site; per-run step log (rows are written to `flow_run_steps`, never rendered); test mode; re-enrollment policy. | Roughly fifty triggers (appointment status, opportunity changes, form/survey, email/SMS events, payments, membership, birthday, custom webhook) and a long action list (if/else with N branches, goal events, wait until time/event, math, custom code, Slack, internal notification, Google Sheets). Email and SMS heavy. | **meaningful** — engine is sound; the library is thin |
| Channels & inbox | WhatsApp on the Meta Cloud API: HMAC-verified webhook, idempotent by `wa_message_id`, text/image/document/audio/video/interactive, media copied to R2, template sync nightly and template creation from the app, reply buttons and lists, 24h window anchored to Meta's timestamp, monotonic delivery ticks, assignment, unread counts. Website chat widget with AI, Turnstile, lead capture after N messages, human handoff, its own `/chat` page. Transactional email via Resend. Missing in the inbox: quick replies, internal notes, filters (mine / unassigned / unread), message search, one list for WhatsApp and web chat, more than one number in use. No SMS, Instagram or Messenger DMs, calls, or email as a thread. | One conversation view for SMS, email, WhatsApp (paid add-on per sub-account), FB and IG DMs, GBP messages, live chat, calls; snippets, internal comments, filters, search, LC Phone. | **critical** — inbox ergonomics, not channel count |
| Reporting | Sales report over 30/90/365 days: four-step funnel, conversion percentage, won value, by source, by site, by agent (won, open, messages sent, tasks done), by month bars, median and slowest first-response time. Dashboard: open deal value, unread, pending quotes, tasks, today's agenda, onboarding checklist. UTM, gclid and fbclid captured per lead. Missing: per-stage funnel per pipeline, sales cycle length, custom date range, revenue from issued or paid documents, booking counts, report export, scheduled report email. | Dashboard widgets, per-stage pipeline reports, source and ad attribution (Google/Meta ads connected), call and appointment reports, agent reports, custom dashboards. | **meaningful** |
| Booking & calendar | Booking types with duration, slot increment, buffers, min notice, max advance, per-day cap, seat capacity, round-robin or any resource, people and non-people resources, weekly rules intersected with business hours, blackouts, tenant-timezone horizons, deposits by bank transfer with expiry job, public page with brand colour, iframe embed with auto-height, self-service cancel/reschedule with cutoff, reminder chain template → free-form WhatsApp → email → logged "none", no-show as a manual action, Google Calendar one-way busy sync, week/month agenda. Missing: recurring appointments, day view, drag to move, per-staff public pages. | Round-robin, collective, class, service and resource calendars, recurring appointments, Stripe deposits, reminders via workflows, two-way Google/Outlook sync. | **ahead** **cosmetic** — WhatsApp reminder chain and transfer deposits fit the market better |
| Forms, sites, funnels | Hosted form page per tenant with honeypot and optional Turnstile, but every form is the fixed trio name/phone/email (`forms/actions.ts:19-23`); the field editor is a stated later pass. No embed snippet, no UTM on hosted forms. Two ingest lanes: keyed server-to-server API, and a no-secret webhook lane that captures the first payloads so the admin maps fields against real data (Elementor, Wix, Webflow, Zapier). Per-site routing, health and stale alerts. No page, funnel or website builder. | Drag-drop form and survey builder with conditional logic, funnel and website builder, blogs, chat widget, all with attribution. | **meaningful** — form editor + embed; builder stays out by decision |
| Own billing | Plans of 3/6/12 months priced in PYG, limits on users, contacts and sites enforced, manual ledger of transfers and cash recorded by superadmin, 7-day grace then read-only enforced at the `tenantDb` layer, expiry warning emails, superadmin creates every tenant, vertical presets applied on first login. No self-serve signup, no gateway, no invoice for VenderCRM's own fee, AI and message usage metered but not billed, no agency or white-label layer. | Stripe-based SaaS mode, sub-accounts, agency white-label, marketplace, rebilling of usage. | **cosmetic** today — meaningful once tenants exceed what one person can invoice by hand |
| Mobile | Manifest-only PWA, no service worker, no push (`manifest.ts:3-6`), separate mobile nav, inbox is a polling web page. | Native LeadConnector app with push, calls, inbox, calendar, payments. | **critical** — a rep in the field must learn a message arrived |
| Quotes & documents | Quotes with catalog or free lines, flat discount, PYG or USD, public token page and PDF, WhatsApp delivery with link fallback, convert to nota de venta, per-tenant numbering, issue/void, payment ledger with partial payments, audited void and payment deletion. No IVA on products or lines, no online accept, no auto-expiry job, no payment link. | Invoices and estimates with Stripe payment links, e-signature on documents, recurring invoices, text-to-pay. | **meaningful** — online accept + IVA lines |
| Everything else GHL sells | Reputation: a `send_review_request` action exists; no GBP review pull. AI: draft-then-approve with per-conversation and per-tenant daily caps re-checked at approval time. Snapshots: vertical presets in onboarding. Audit log, superadmin WhatsApp health, one login across tenants. Absent: memberships, courses, social planner, ad manager, Voice AI, missed-call textback, communities. | All of the above, most of it aimed at US agencies. | **cosmetic** — nothing here sells in this market |


### Is email conspicuously missing?

No, as a channel. Yes, as a delivery method. Paraguayan SMBs and their customers run on WhatsApp; an email inbox would be built, warmed and maintained for a channel the target user does not check. What the code does miss is cheap: the Resend client already sends invites and reminders, so "send this quote, nota de venta or booking confirmation to an email address" and a `send_email` automation action are days of work and matter for constructoras and B2B firms whose purchasing departments want a PDF in a mailbox. Keep marketing email and email threads out.

Instagram DMs are a different story. For clínicas and inmobiliarias in Asunción, Instagram is the second inbound channel after WhatsApp, and Meta serves it through the same Graph API the WhatsApp module already speaks. That is the one extra channel worth scoping.

## 2. Where VenderCRM can win outright

### WhatsApp is the engine, not a bolt-on

GHL charges WhatsApp per sub-account and treats it as one more conversation provider. Here the 24h window is anchored to Meta's own timestamp, `wait_for_reply` is a first-class node with a timeout branch, the opt-out keyword gates every automated send, AI drafts are re-checked against window and opt-out at approval time, and booking reminders degrade template → free-form → email with every rung logged. None of this exists in GHL's WhatsApp. This is the moat that already exists; every "now" item below deepens it.

### Money that behaves like guaraníes

PYG with no minor unit, transfer-and-comprobante deposits because "the money never touches this system" (`deposits.ts:11-22`), prepaid plans priced in PYG. GHL's ladder starts at USD 97 a month and its payments assume Stripe, which does not serve Paraguay. VenderCRM can undercut on price and still be the more honest fit.

### SIFEN is the moat that is not built yet

GHL will never issue a factura electrónica. Today neither does VenderCRM. The seam is clean and the check-digit and CDC math are pinned to SET's own vectors, but the DE generator, signing, SOAP submission and KuDE are all stubs. Once built, "your quote becomes a legal invoice in the same tool that handles the WhatsApp conversation" is a sentence no US product can say. It needs the spec document first.

### Lead ingest that meets sites where they are

The hook lane's capture mode (store five payloads, let the admin map fields against real data, then go live) is friendlier than GHL's inbound webhook for the Elementor and Wix sites Paraguayan agencies actually build. Combined with per-site routing, health and stale alerts, this already beats GHL for a multi-site owner.

### Fewer, sharper features

GHL's known objection is that a clinic owner cannot find the pipeline under Sites, Memberships, Reputation and Agency tabs. VenderCRM has an onboarding checklist, vertical presets, voseo Spanish, one login across businesses, and a superadmin who can see every tenant's WhatsApp health. Simplicity sells only if the daily-driver surfaces (inbox, pipeline, contact) are excellent, which is why the ranking below spends there first.

### Operational honesty

Audit log on destructive actions, tenant isolation re-checked per request, read-only lockout enforced in the data layer, durable job queue with a stuck-run reaper. Invisible to buyers, decisive for keeping ten paying tenants without a support team.

## 3. The ranked build list

Everything under "now" and "next" runs on the current Hostinger single-process shape: jobs go through the MySQL queue, realtime stays polling, web push is sent by the worker. The one infrastructure change that precedes growth is listed where it belongs.

### Now — the daily driver and the moat

1. **Automation library batch.** Triggers `quote_sent`, `document_sent`, `document_paid`, explicit `deal_won` / `deal_lost`; actions `create_task`, `notify_user`, `send_email`; conditions on deal value, lead source and site. Follow the `deal.stage_changed` pattern: emit from `quotes/delivery.ts`, `documents/delivery.ts` and `recordPayment`, subscribe in `automations/triggers.ts`, widen `TRIGGER_TYPES`, add i18n keys (and the five missing ones), tests. Add the per-run step log page while there; the rows already exist. — Sonnet · 2–3 PRs · closes the gap the brief confirmed
2. **Inbox ergonomics.** Quick replies with variables, internal notes on a thread, filters for mine / unassigned / unread / open, message search, and web-chat conversations in the same list with a channel chip. A rep who has GHL's snippets will not go back to typing. — Sonnet · 2 PRs · the "critical" row above
3. **Web push.** Service worker plus VAPID, subscriptions per user and device, a `push.send` job kind, fired on inbound WhatsApp message on an assigned or unassigned conversation, task due, and the `notify_user` action. Works on Android and on installed iOS PWAs. This turns the manifest into a phone app and removes the strongest reason a field salesperson keeps WhatsApp Business open instead. — Opus · 1 PR · makes item 2 reach the pocket
4. **Pipeline polish.** Value total per column, days-in-stage badge with a per-stage threshold, expected close date, real in-column ordering, lost reason as its own field. All of it reads columns that already exist. — Sonnet · 1 PR
5. **Custom field definitions.** A per-tenant definitions table (text, number, date, select, phone), rendered on the contact page and edit form, importable, exportable, filterable in saved views, usable in automation conditions and template variables. Vertical presets seed them. The JSON column is already there. — Sonnet · 2 PRs · the one contact gap clients will name
6. **Three small corrections.** Honour the opt-out tag on manual inbox sends with an override confirmation; a nightly job that sets `expired` on quotes past `validUntil`; move contact list pagination and filters into SQL before any tenant passes a few thousand contacts. — Sonnet · 1 PR each


### Next — the quarter after

7. **Customer accepts the quote online.** Accept / reject buttons on the public quote page, with a `quote_accepted` trigger and an automation that moves the deal and drafts the nota de venta. PLAN §11 deferred this deliberately; reopen it, because it is the step that makes item 1 pay off. — Sonnet
8. **Template campaigns to a saved view.** Pick an approved template, a view and a send window; the worker paces sends through the jobs table, skips opt-outs, records each as a message with a campaign id, and reports delivered / read / replied. This is the marketing feature this market asks for, deliberately compliance-sensitive per PLAN §11: per-tenant daily caps and a quality-rating check on the number belong in the spec. — Opus · needs a Fable spec paragraph first
9. **Reporting v2.** Per-stage funnel per pipeline, sales cycle length, custom date range, revenue as issued and paid documents beside won value, booking counts and no-show rate, CSV export of every table. — Sonnet
10. **Form field editor and embed snippet.** Reorder and add typed fields, conditional show/hide, an iframe snippet with auto-height like the booking embed, UTM forwarded from the hosted page. — Sonnet
11. **Companies and merge.** An organisation entity contacts and deals can hang off, and a merge action that keeps the older contact's history. Both matter for constructoras and B2B. — Sonnet
12. **Email delivery of quotes, notas and bookings.** The one email feature worth building; the Resend client is already in place. — Sonnet · small
13. **Instagram and Messenger DMs.** Same Meta app, same webhook shape, same conversation tables with a channel column. Scope after the inbox is unified, not before. — Opus


### Later — the bets

14. **SIFEN engine.** Write `PLAN-SIFEN.md` (persistence port owned by `modules/invoicing/`, timbrado state machine, habilitación workflow), then build DE XML, XMLDSig with tenant certificates, SOAP sync and batch, KuDE with QR, events. Feasible on Hostinger: it is CPU-light and the queue already gives the contingency retry. Use it first for VenderCRM's own fee invoices. — Fable spec · Opus build · the outright win
15. **Payment link on the nota de venta.** Bancard or Pagopar checkout link with a webhook that records the payment and fires `document_paid`. Depends on merchant onboarding the owner controls, so it sits behind item 1's trigger, not in front of it. — Opus
16. **Self-serve signup and gateway billing.** Manual invoicing is right until the tenant count passes what one person renews by hand; then signup, trial, Bancard recurring, and a fee invoice that item 14 makes legal. — Sonnet
17. **Infrastructure step.** When automation and campaign volume make the 2-second in-process tick visible, lift `src/worker/index.ts` into its own Node process on a small VPS pointed at the same MySQL. The code already allows it. Not before item 6's pagination fix.


### Not doing, on purpose

- Email inbox or marketing email, SMS, voice and missed-call textback: wrong channel for the market and a deliverability burden with no upside.
- Funnel or website builder: sold as a service by clientes.com.py, and the sites already post leads in.
- Native iOS and Android apps: web push on the installed PWA covers the field use case.
- Memberships, courses, social planner, ad manager, agency white-label: GHL sells these to US agencies, not to a clínica in Asunción.


## 4. The owner's idea round (2026-09-05)

Answers to the follow-up questions, now written into `PLAN.md §15` on branch `claude/new-session-5nmnni` as batches J1–J12 with a parking lot. Short form here.

### Email: one Resend account, per-tenant identity

Every tenant sends through the platform's single Resend account. Nobody brings their own key. A tenant that wants mail from its own domain gets the domain verified *inside* the platform account through Resend's Domains API, which isolates reputation per domain. Three tiers, one resolver function.

| Tier | From | Setup |
|---|---|---|
| Default, every tenant | `Nombre del negocio <notificaciones@mail.clientes.com.py>`, reply-to the tenant's address | none |
| Own domain (premium or on request) | `Nombre del negocio <ventas@cliente.com.py>` | admin types the domain, the app shows three DNS records, a job polls verification for 72 h |
| Operator-assisted | same | you do the DNS while impersonating, for clients who pay for it |


Use a dedicated sending subdomain for the default tier so a tenant's booking reminders never share reputation with your own mail. Put a per-tenant daily email cap in plan limits from day one, because Resend's quota is per account. Every automation-sent email carries an unsubscribe link that sets the same opt-out tag WhatsApp uses.

### Documents: which ones are code and which one is yours

| Document | Status | Fiscal | What it takes |
|---|---|---|---|
| Presupuesto | **shipped** | no | online accept/reject is the missing half (J4) |
| Nota de venta | **shipped** | no | — |
| Recibo | **now** | no | render from a payment row with the existing document shell; small |
| Contrato | **next** | no | editable templates with variables, generated per deal, public page, click-to-accept with an evidence record (name, time, IP, PDF hash, optional drawn signature). A *firma electrónica simple* under Ley 4017/2010, and the page says so |
| Factura electrónica | **later** | **yes** | engine is Opus work after `PLAN-SIFEN.md`; your side first |


**Your side of the factura, none of it code:** RUC active and Marangatu access with e-Kuatia; a digital-signature certificate from an accredited PSC for each business that will invoice; a timbrado electrónico for the emitting establishment; the current Manual Técnico and test credentials fetched from your machine; one tenant willing to run the habilitación test cycle. Do it for your own business first, and the engine's first customer is VenderCRM's own subscription invoice.

### The coach: three levels, then voice

1. **"Hoy" panel, rule-based, no AI.** A ranked to-do computed from data already in the tables: unanswered conversations over an hour, deals past a per-stage age threshold, quotes sent three days ago with no reply, leads with no deal, tomorrow's bookings with no confirmed reminder, overdue tasks. Each row carries its one action. The same list is the morning push and a WhatsApp template to your own number. — now · J6 · deterministic and free
2. **Weekly briefing written by AI.** Monday morning the worker takes the week's numbers and asks the model for a short narrative in voseo plus three recommendations, stored, shown on the dashboard, sent by WhatsApp template and email. Same caps and ledger as the auto-reply. — next · J7
3. **Conversational coach.** "¿A quién debería llamar hoy?" answered by the model through read-only tools over the tenant's data. Text first. — later · J8


**Voice, two lanes.** Lane A now: transcribe inbound WhatsApp voice notes (the audio is already in storage) and show the text under the bubble, so reps read instead of listening and the AI reply can answer audios; the owner can also send a voice note to the coach and get the "Hoy" list back. Lane B later: push-to-talk in the installed PWA using the browser's speech recognition, answers read aloud. Voice without a coach is only a microphone, so B follows level 3.

### WhatsApp connection: today's procedure and the better one

**Today, per number, manual connect.** One platform Meta app; the webhook is configured once. The business needs a Meta Business Manager and a number not on the WhatsApp Business app. In Business Manager it creates or picks the WABA, adds and verifies the number, and notes the WABA id and phone-number id. It creates a system user, assigns the WABA and the platform app to it, and generates a permanent token with the messaging and management permissions. In VenderCRM's WhatsApp page it pastes WABA id, phone-number id, display number and token; the app encrypts the token, syncs templates and goes live. You do this on a call with each client. Fine for hand-onboarded tenants, wrong for self-serve.

**Interim for third-party clients.** The client shares its WABA with your business as a partner in Business Settings, and your own system user then holds the token and subscribes the app to that WABA. One system user, many client WABAs, no client touching tokens. Verify against Meta's current docs before making it the documented flow.

**The better path is embedded signup**, still gated on your Meta Business verification and Tech Provider approval. The client clicks "Conectar WhatsApp", picks the number in Meta's own dialog, and the app exchanges the code for a token. It unlocks two things manual connect cannot: coexistence, where the number stays on the WhatsApp Business app and uses the API at the same time, which removes the biggest onboarding objection; and more than one number per tenant in the inbox, which the schema already allows. Start the verification now; nothing in J1 to J8 waits on it.

### Decisions only you can make before the batches start

- The sending subdomain name, and whether own-domain email is a premium tier or included.
- Start Meta Business verification and the Tech Provider request now.
- Which provider transcribes audio (Gemini or OpenAI both fit the driver seam; pick by price per minute).
- The SIFEN prerequisites for your own business first.
- Contracts with a drawn signature or click-to-accept only. Click-to-accept is enough for a firma electrónica simple and is simpler on a phone.


## 5. How to start the build

The "now" batches are one phased, autonomous build. Two Opus phases run first, one after the other, because they create things every other phase calls: the new triggers, actions and notification rows, then web push. Five Sonnet phases then run in parallel, each owning its own files, and a Sonnet link pass ties them together. A watcher Routine restarts stalled phases and pings you; nobody supervises live, and Fable is never a build model.

| Phase | Model | What it ships | Prompt file |
|---|---|---|---|
| P1 Automation library | Opus | quote/document/payment/won/lost triggers, create task, notify user, send email, new conditions, run detail page, the five missing labels | `prompts/opus-p1-automation-library.md` |
| P2 Web push | Opus | service worker, VAPID, subscriptions, push on inbound message, assignment, task due, notifications | `prompts/opus-p2-web-push.md` |
| P3 Inbox ergonomics | Sonnet | quick replies, internal notes, filters, search, web chat in the list, opt-out confirm | `prompts/sonnet-p3-inbox.md` |
| P4 Email identity | Sonnet | sender resolution, own-domain verification panel, daily cap, "enviar por email", unsubscribe | `prompts/sonnet-p4-email-identity.md` |
| P5 Pipeline + custom fields | Sonnet | column totals, stale badge, expected close, lost reason, custom field definitions everywhere, SQL pagination | `prompts/sonnet-p5-pipeline-custom-fields.md` |
| P6 Quote accept + receipts | Sonnet | accept/reject on the public quote, quote expiry job, recibos with PDF and public link | `prompts/sonnet-p6-quote-accept-receipts.md` |
| P7 "Hoy" panel | Sonnet | ranked daily to-do on the dashboard, morning push | `prompts/sonnet-p7-hoy-panel.md` |
| P8 Link pass | Sonnet | nav, handoff doc, known issues, closing report | `prompts/sonnet-p8-link-pass.md` |


1. Merge the PR with the plan first, so phase 1 branches from a main that contains it.
2. Open a fresh window on this repo. Model **Opus**. Permission mode **auto-accept**, because spawned children can never be more permissive than their parent.
3. Paste exactly: `Read prompts/opus-p1-automation-library.md in this repo and execute it.`
4. P1 spawns P2. P2 creates the watcher and spawns P3 to P6; the watcher starts P7 and, when everything is merged, P8. If a session dies, re-paste its prompt line in a fresh window with the model from the table; every prompt resumes from the first unmet exit criterion.
5. Questions a phase cannot answer land in `docs/decisions-needed.md` and the watcher notifies you. Answer by editing the file or the prompt on main, never by messaging a running session.


Nothing in P1 to P8 waits on Meta, SIFEN or DNS. Push and email degrade to "not configured" until you add keys. The later wave (contracts, voice notes, weekly briefing, campaigns, embedded signup) gets its prompts after this wave has merged and you have used it for a week.

## 6. Your to-do list outside the code

Everything only you can do, ordered by when the build first needs it. Nothing here is urgent today; the first three items are the ones to schedule this month because they have lead time.

### Start this month (lead time measured in weeks)

1. **Meta Business verification.** Go to business.facebook.com → Settings → Security Center → Start verification. You need the legal business name, the RUC, a document showing both (constancia de RUC works), the business address and a phone or email on the business domain. Meta answers in days to weeks. Nothing in the build waits for it; embedded signup, coexistence and multi-number all do. — needed by: wave 2, embedded signup
2. **Tech Provider request.** After verification, in the Meta app dashboard: App Review → request advanced access for `whatsapp_business_management` and `whatsapp_business_messaging`, then WhatsApp → Embedded signup → apply as a Tech Provider. Expect a form about your business model and a screencast of the connect flow; the P-wave app with the manual connect page is enough to record it. — needed by: embedded signup
3. **SIFEN prerequisites for your own business.** In order: confirm the RUC is active and you have Marangatu access; request the certificado de firma digital from an accredited PSC (Documenta or eFirma; you present the RUC, cédula and a form, and receive a .p12 file plus a password); in Marangatu request a timbrado electrónico for the establecimiento and punto de expedición that will invoice; download the current Manual Técnico and the test environment credentials from the SET e-Kuatia portal and put them in a private folder Claude Code can read from your machine. When these four exist, open a Fable session and ask for PLAN-SIFEN.md. — needed by: SIFEN engine (later)


### Before you merge P4 email (10 minutes, any day)

4. **Pick the sending subdomain**, for example `mail.clientes.com.py`, and add it as a domain in your Resend account. Resend shows three DNS records (DKIM TXT, SPF/return-path MX + TXT, DMARC TXT). Add them at the DNS host for clientes.com.py and click verify. Then set `EMAIL_DEFAULT_DOMAIN=mail.clientes.com.py` in hPanel next to `RESEND_API_KEY`. Decide whether own-domain email is included or a premium add-on; it changes only copy on the settings page. — needed by: P4


### When P2 push merges (10 minutes)

5. **Generate VAPID keys** with the script the phase adds (`npx tsx scripts/generate-vapid.ts`), paste the three values into hPanel (`WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT=mailto:your address`), redeploy, install the PWA on an Android phone, enable notifications in settings, send yourself a WhatsApp message and confirm the push arrives. iPhone works only when the app is added to the home screen from Safari. — needed by: P2 verification


### Standing items from earlier handoffs, still open

- **Run the migrations** from your machine after each merge, exactly as docs/HANDOFF.md §1.1 describes, and run the backup restore check first the day you do a large batch.
- **Cloudflare R2** as the storage driver before onboarding a tenant beyond your own business; WhatsApp media on Hostinger disk is non-durable.
- **The five owner fields** in the marketing site config (WhatsApp number, phone, email, address, RUC) are still null, so the live site shows no WhatsApp button. One file, no deploy logic.
- **Audio transcription provider** for the voice-note phase in wave 2: a Gemini or OpenAI key that allows audio; pick by price per minute.
- **WhatsApp templates** for the morning "Hoy" message and the weekly briefing must be submitted and approved in WhatsApp Manager; the app can submit them, Meta approves in hours to days.


## 7. Business memory and the AI setup assistant

Added after the owner's request, specified in `PLAN.md §16` on its own PR, stacked on the plan PR. Two things on one foundation.

### Memoria del negocio

One structured record per business: profile (what it is, who it serves, tone, what never to promise), hours, address, services with prices, policies for señas, cancellation, payment and warranty, FAQs, promos with dates, and internal notes that never reach a customer. It replaces the five free-text AI fields in settings and feeds AI replies on WhatsApp and the widget, template variables like `{{negocio.horario}}`, the public booking page, the PDF footers and the coach. Retrieval uses MySQL full-text search inside a token budget, so it runs on Hostinger with no vector database. Facts the AI extracts from pasted text, a PDF or a website wait for a human to confirm before any prompt uses them.

### Asistente de configuración

On first login, or from settings, or by you on a client's tenant, a conversation in voseo asks one topic at a time: what you do, how people contact you, hours and address, services and prices, policies, the five most common questions, how the assistant should talk, what it must never promise. Each answer is written to the memory. Then one structured AI call produces a complete plan in the same data shape the vertical presets use: pipeline stages, tags, booking types, quick replies, welcome and follow-up and review flows, business hours, AI mode set to draft. You see the preview, tap apply, and the existing preset machinery creates it all, idempotently, removing nothing.

**The rule that keeps it safe.** The AI produces data in the preset shape; it never produces code paths and never bypasses the apply function. Everything it proposes is a preview until confirmed, every apply is audited and stored, and it runs under the same per-tenant daily AI caps as auto-replies.

| Phase | Model | Ships | Prompt file |
|---|---|---|---|
| K1 Business memory | Opus | schema with full-text index, memory module and retrieval, structured-output driver method, settings page, AI replies reading the memory | `prompts/opus-k1-business-memory.md` |
| K2 Setup assistant | Opus | preset shape extensions, the conversation, plan generation, preview and apply, superadmin "Configurar con IA" | `prompts/opus-k2-setup-assistant.md` |
| K3 Imports and variables | Sonnet | text, PDF and URL import with review, template variables, coach rows, public page and PDF reads | `prompts/sonnet-k3-memory-imports.md` |


K1 and K2 touch only files the P-wave leaves alone, so they can run in a second Opus window at the same time as P1. K3 waits for the P-wave's link pass. Start line for wave K, after both PRs merge: `Read prompts/opus-k1-business-memory.md in this repo and execute it.`
