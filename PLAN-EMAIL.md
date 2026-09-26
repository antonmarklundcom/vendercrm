# PLAN-EMAIL — Per-domain mailboxes in VenderCRM via Cloudflare Email Service

Status: E1–E5 built (docs/log/e1.md, e2.md, e4.md, e5.md), off by default. Go-live checklist: docs/log/e5.md. Written 2026-09-25. Build prompt: `prompts/opus-e1-cloudflare-mailbox.md`.

Goal: every tenant domain (e.g. `contacto@clientdomain.com.py`) gets its own
inbox inside VenderCRM. Inbound mail is received by Cloudflare, parsed by a
Worker and stored in VenderCRM. Replies go out from the CRM. The existing
Resend path keeps working the whole time and is the default until Cloudflare
is switched on.

---

## 1. Cloudflare facts (verified 2026-09-25, recheck before go-live — product is in public beta)

### What it is
- **Cloudflare Email Service**: developer email infrastructure, **not** a mailbox host.
  - **Email Routing (inbound)**: receives mail for a domain and forwards it to an
    address or hands it to a Worker (`email(message, env, ctx)` handler). Free, unmetered.
  - **Email Sending (outbound)**: send via Worker binding or REST API with an API token.
    Public beta since 2026-04-16. Shared IP pool; no self-serve dedicated IPs.
- **No IMAP/POP3, no webmail, no storage.** Apple Mail/Outlook/Gmail app cannot
  connect. The inbox UI, threading and storage are ours (VenderCRM + R2).

### Pricing
| Item | Cost |
|---|---|
| Workers Paid plan (required, per **account**, not per domain) | $5 / month |
| Outbound emails included | 3,000 / month per account |
| Outbound overage | $0.35 per 1,000 |
| Hard bounces | count toward quota |
| Sends rejected at API (e.g. suppression list) | do not count |
| Sends to your own verified destination addresses | free |
| Inbound Email Routing | free, unmetered |
| DNS zones on Free plan | $0 per domain, unlimited |
| Workers requests | 10M/month included, then $0.30 per 1M |
| R2 storage (attachments/raw mail) | 10 GB free, then $0.015 / GB-month |
| **Avoid**: upgrading a zone to Pro | $20–25 / month **per domain** |

Worked examples:
- 100 domains × 1 sent + 1 received per day ≈ 3,000 out/month → **~$5.00–5.04/month**.
- 50 domains × 200 sent/month = 10,000 out → $5 + 7 × $0.35 = **~$7.45/month**.

### Limits
- Outbound message max 5 MiB incl. attachments; inbound max 25 MiB.
- Daily sending quota is **per account**, starts low on new accounts and grows with clean reputation.
- Suppression lists and abuse enforcement are **per account** → one bad tenant can
  get sending suspended for all tenants ("blast radius").

### DNS requirement
- Each domain must use **Cloudflare nameservers** (full setup). Registrar can stay
  Hostinger. Partial/CNAME setup (keep DNS at Hostinger) needs Cloudflare Business — not an option.
- Cloudflare then manages MX / SPF / DKIM / DMARC for mail.
- Zero-downtime migration per domain:
  1. Add domain in Cloudflare; it imports existing records.
  2. Compare every record against Hostinger's DNS panel (A, AAAA, CNAME, TXT, MX).
     Point A/AAAA back to the Hostinger server IP.
  3. **MX warning**: if the domain currently uses Hostinger email, switching
     Email Routing on moves inbound mail to Cloudflare. Decide per domain.
  4. Change nameservers at Hostinger to the Cloudflare pair. Wait for "Active".
- Client domains in our Cloudflare account = we control their DNS. Offboarding
  means handing the zone back. Put this in the client terms.

### Business/legal notes
- Owned domains vs client domains cost the same; risk differs.
- For client tenants we are a **data processor** (GDPR-style DPA where relevant).
- Terms of service must forbid cold/bulk email. No CSV-blast feature in the inbox.

---

## 2. What already exists in VenderCRM (reuse, do not duplicate)
- `src/lib/email/index.ts` `sendEmail()` — single send entry point, never throws,
  no-ops when unconfigured. Resend client lives here.
- `src/lib/email/sender.ts` `senderFor(ctx)` — resolves tenant From/Reply-To.
- `src/modules/tenancy/email-domains.ts` + `tenant_email_domains` — per-tenant sending domains (Resend today).
- `src/modules/tenancy/email-log.ts`, `email_log` table, `maxEmailsPerDay` plan cap (`limits.ts`).
- `src/lib/storage` — S3-compatible client (works with R2).
- `tenantDb(ctx)` — tenant isolation in app code (MySQL, Drizzle). **No Postgres RLS**;
  every new table carries `tenant_id` and is read only through `tenantDb`, with an isolation test.
- Superadmin area `src/app/(superadmin)/tenants`.

---

## 3. On/off switch (works before Cloudflare exists)

Two layers, both default **off**, so deploying the code changes nothing:

1. **Env vars (global, platform level)** — follows the repo's existing "optional
   config = feature degrades" pattern:
   - `EMAIL_PROVIDER` = `resend` (default) | `cloudflare` — for platform/transactional mail
     (password reset, invites, notifications). Stays `resend` until Anton swaps it.
   - Mailbox replies (E4) always go via Cloudflare, independent of `EMAIL_PROVIDER`,
     so the inbox can run on Cloudflare while password recovery stays on Resend.
   - `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN` — outbound via REST.
   - `EMAIL_INBOUND_SECRET` — HMAC secret shared with the Worker. Unset → the
     inbound webhook returns 404 and the Inbox feature is hidden everywhere.
   - If `EMAIL_PROVIDER=cloudflare` but its vars are missing → fall back to Resend
     and log a warning (never crash boot).
2. **Per-tenant toggle in superadmin** — `tenants.mailbox_enabled` boolean
   (default false), switched on the superadmin tenant page. Lets us enable one
   test tenant first, then roll out. Also the kill switch for an abusive tenant
   (separate `outbound_suspended_at` set by the circuit breaker, clearable there too).

Inbox visible for a tenant = env configured **and** `mailbox_enabled`.

---

## 4. Phases

### E1 — Switch + provider abstraction (small, safe to ship first)
- Env vars above in `src/lib/config/env.ts` (all optional).
- `src/lib/email/providers/{resend,cloudflare}.ts` behind one interface; `sendEmail()` picks by `EMAIL_PROVIDER`. Behavior with default env is byte-for-byte unchanged.
- Migration: `tenants.mailbox_enabled`, `tenants.outbound_suspended_at`.
- Superadmin tenant page: toggle + "clear suspension" button, audited.
- `isMailboxAvailable(ctx)` helper used by nav/UI.

### E2 — Inbound pipeline
- `workers/email-inbound/` (separate Cloudflare Worker, own `wrangler.toml`, not part of the Next build):
  `email()` handler → `postal-mime` parse → raw `.eml` + attachments to R2 →
  POST JSON to `/api/v1/email/inbound` signed with HMAC (`EMAIL_INBOUND_SECRET`, timestamp, 5-min window).
  If webhook fails, keep raw in R2 and retry; never drop mail.
- Route: verify HMAC, resolve tenant by recipient domain via `tenant_email_domains` (status verified + mailbox enabled), else 202 and discard-log.
- Idempotent on `Message-ID`.

### E3 — Storage + threading
- Tables (all `tenant_id`, indexed): `mailboxes` (address, domain_id, display name),
  `email_threads` (subject, contact_id, deal_id, last_message_at, status open/closed, unread),
  `email_messages` (direction in/out, message_id, in_reply_to, references, from/to/cc, text, sanitized html, r2 raw key, status),
  `email_attachments` (r2 key, filename, mime, size).
- Threading by `In-Reply-To`/`References`, fallback normalized subject + participant within 14 days.
- Auto-link sender to existing contact by email; create contact (source `email`) if none.
- Isolation tests like `ops.isolation.test.ts`.

### E4 — Inbox UI
- `/inbox/email` (or tab in existing inbox): thread list, thread view, reply composer,
  attachment download via signed URL, link to contact/deal. HTML sanitized, remote images blocked by default.
- Reply sends through `sendEmail()` with correct `In-Reply-To`/`References` and the mailbox address as From.

### E5 — Blast-radius guard
- Per-tenant daily cap for mailbox replies (reuse `maxEmailsPerDay`/`email_log`), new-tenant warm-up (e.g. 20/day first 14 days).
- 1-to-1 only: max recipients per message (e.g. 5), no bulk/CSV.
- Bounce/complaint ingest (Cloudflare events or bounce mail parsed in E2) → if bounce rate > 3% over last 50 sends or any complaint spike → set `outbound_suspended_at`, notify superadmin.

### E6 (later, optional) — AI triage
- Classify inbound (lead / support / billing / spam), extract contact info, suggest pipeline stage. Behind a per-tenant flag.

---

## 5. Go-live checklist (manual, Anton)
1. Cloudflare account → Workers Paid ($5).
2. Move one test domain's nameservers (checklist §1 DNS).
3. Enable Email Routing + Email Sending on it; create API token (Email Sending only).
4. Create R2 bucket; deploy `workers/email-inbound` with `wrangler`; set its secrets.
5. Set env vars on Hostinger, redeploy.
6. Superadmin → enable `mailbox_enabled` for the test tenant. Send/receive test.
7. Only then `EMAIL_PROVIDER=cloudflare` and roll out tenant by tenant.

Sources: developers.cloudflare.com/email-service/platform/pricing/,
developers.cloudflare.com/email-service/, blog.cloudflare.com/email-service/.
