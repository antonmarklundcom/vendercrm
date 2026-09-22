# Next session: clientes.com.py finish + client email research

Repo: `antonmarklundcom/vendercrm`. Run on **Opus**, never Fable
(fable-cost-guardrail). Cloud session is fine; nothing here needs Anton's PC
except item 3.

## State when this was written (2026-09-22)

PR #138 (branch `claude/affectionate-pascal-e1lgdi`) holds three commits:
1. Marketing site repositioned for Paraguayan **pymes**: sell clients, sales
   and bookings, not the CRM. Hero shows a lead feed, not a CRM screenshot.
   Home has a pymes FAQ (+ FAQPage JSON-LD).
2. `/u/[token]` unsubscribe now needs a POST (confirm button), so link
   scanners can't opt contacts out. Quote-form CAPTCHA recorded as accepted
   risk in `KNOWN-ISSUES.md`.
3. New `/soluciones/{comercios,gastronomia,talleres}` pages (es/en/sv).

Owner decisions, do not reopen:
- clientes.com.py sells **results** (clients, sales, bookings). No CRM pitch,
  **no public pricing** on this site. The "from Gs. 49.000/month, push yearly"
  pricing is for Anton's other projects (sitio.com.py / negocio.com.py).
- No social proof yet: never invent testimonials, logos or case numbers.
- No Google Analytics until there is traffic.

## Do, in order

1. **Get PR #138 green and merged-ready.** Check out the branch, run
   `npm ci`, `npm run typecheck`, `npm run lint`,
   `npx vitest run src/i18n src/middleware.test.ts`. Fix anything red, push.
   Subscribe to the PR's activity.
2. **Bug seen but not fixed:** on light-background pages (e.g.
   `/soluciones/gastronomia` at 390px) the secondary "Escribinos por WhatsApp"
   button in the header CTA pair renders as a dark block with the icon but
   **no visible label**. Check `src/components/marketing/cta.tsx` and the
   `.mk-*` button styles in `src/app/globals.css`. It may already exist on
   `main`; fix it either way. Verify with a Playwright screenshot. Chromium is
   at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; install
   `playwright-core` in the scratchpad, not in the repo.
   Dev server: `npx next dev` needs a throwaway `.env` with DATABASE_URL,
   APP_ENCRYPTION_KEY (64 hex), CRON_SECRET, BETTER_AUTH_SECRET,
   WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN (dummy values). Marketing
   pages render without a DB. Delete `.env` before committing.
3. **Hero video**: `HERO_VIDEO_SRC` in `src/lib/site-config.ts` points at a
   Higgsfield CloudFront URL, which the cloud proxy blocks. Anton downloads the
   mp4 on his PC, then commits it as `public/videos/hero-loop.mp4` (keep it
   under ~4 MB) and points the constant at `/videos/hero-loop.mp4`.
4. **Contact details**: `src/lib/site-config.ts` has phone, email, address
   and RUC as `null`. Ask Anton for the values; don't invent them.
5. **Lead form key**: the /contacto form posts to the app's own
   `/api/v1/leads` and needs `VENDERCRM_API_KEY` on the Hostinger app. Without
   it, form leads are only logged and dropped. The setup is Anton's to do: CRM, then
   Sitios, then create site "clientes.com.py", copy the key into Hostinger's
   env vars, redeploy, and submit the form once to confirm.
6. **Research only, no code: client mailboxes** (see below). Write the
   result as `docs/CLIENT_EMAIL_OPTIONS.md` in a separate PR.

## Client email research brief

Goal: offer Anton's clients `nombre@sunegocio.com.py` mailboxes cheaply, set
up from their account in VenderCRM (sub-accounts), without Anton running
a mail server.

Compare, with **current prices verified on the providers' own sites**:
Migadu, Purelymail, Zoho Mail (Lite / reseller), Hostinger Business Email,
Google Workspace and Microsoft 365 resale, and self-hosting (Mailcow or
Mailu on a VPS). For each one, cover:
- the cost for 1 client × 3 mailboxes, and for 50 clients × 3 mailboxes;
- whether there's an admin API to create domains and mailboxes, so
  VenderCRM could provision them from a tenant's settings;
- DNS setup (MX, SPF, DKIM, DMARC). Can we generate the records and show
  them to the client, or set them automatically where we control the domain?
- backups and retention, IMAP/webmail/mobile support, and deliverability.

Expected recommendation (confirm or refute it): **don't self-host**. IP
reputation, blacklists, spam filtering and backups become full-time work.
Use a provider with an API and flat or cheap per-domain pricing (Migadu and
Purelymail look like the likely fit) and resell it as an add-on.
Then sketch the VenderCRM feature: a tenant settings page with "Add domain",
a DNS records checklist with live verification, and "Create mailbox". Name
the tables, the API calls, and where the provider's API key lives (env,
never the DB in plaintext; see `APP_ENCRYPTION_KEY` usage). Plan only: no
code until Anton approves.

## Backlog after that (ask first)
- `/recursos` articles for the three new rubros (same rules as the existing
  clusters in `src/content/recursos/`).
- A Google Business Profile for clientes.com.py (`gbp-optimizer` skill),
  once the contact details exist.
