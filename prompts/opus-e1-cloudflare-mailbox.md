# Phase E1–E5 — Cloudflare per-domain mailboxes. OPUS session (medium).

Read first: `PLAN-EMAIL.md` (whole file — it is the spec), `AGENTS.md`,
`src/lib/email/index.ts`, `src/lib/email/sender.ts`, `src/lib/config/env.ts`,
`src/modules/tenancy/email-domains.ts`, `email-log.ts`, `limits.ts`,
`src/db/schema/email.ts`, `src/db/schema/tenancy.ts`, `src/modules/tenancy/db.ts`
(`tenantDb`), `src/lib/storage/**`, one existing isolation test
(`src/modules/ops/ops.isolation.test.ts`), and `src/app/(superadmin)/tenants/**`.

Branch: `phase/email-e1` off latest main. One PR per phase (E1, E2+E3, E4, E5),
each merged green before the next. Log each in `docs/log/e<n>.md`.

Hard rules:
- Everything defaults OFF. With no new env vars set, the app behaves exactly as
  today (Resend path unchanged, no Inbox in nav, inbound route 404). Add a test proving it.
- Env vars are optional in `env.ts`; missing config degrades, never crashes boot.
- Every new table has `tenant_id` and is only read/written via `tenantDb(ctx)`.
  Add isolation tests (tenant A cannot see tenant B's threads/messages/attachments).
- MySQL + Drizzle, one migration per phase, run `npm run check:migrations`.
- Inbound webhook: HMAC-SHA256 over `timestamp.body`, reject > 5 min skew,
  constant-time compare, idempotent on Message-ID. Never log bodies or secrets.
- Sanitize inbound HTML server-side; block remote images by default.
- No bulk-send feature. Max 5 recipients per message.
- The Cloudflare Worker lives in `workers/email-inbound/` with its own
  `package.json`/`wrangler.toml`; exclude it from the Next build/tsconfig.
- Cloudflare Email Sending is beta: wrap the REST call in the provider module
  only, and check the current docs (developers.cloudflare.com/email-service/) for
  the exact endpoint/payload before writing it. Do not guess field names.

Order:
1. E1 switch + provider abstraction + `tenants.mailbox_enabled` /
   `outbound_suspended_at` + superadmin toggle (audited). Ship this first.
2. E2 Worker + `/api/v1/email/inbound`.
3. E3 tables, threading, contact auto-link.
4. E4 Inbox UI + reply.
5. E5 caps, warm-up, bounce circuit breaker.

Each phase done when: `npm run lint`, `npm run typecheck`, `npm test`,
`npm run build` all pass, and the log file lists what Anton must set up by hand
(see PLAN-EMAIL.md §5). Report any Cloudflare API detail you could not verify.
