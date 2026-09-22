# Client mailboxes: provider options and a VenderCRM plan

Status: **research + plan only. No code until Anton approves.**
Written 2026-09-22.

Goal: sell `nombre@sunegocio.com.py` mailboxes to our clients as a cheap
add-on. The client creates them from their own VenderCRM account (their
tenant), and nobody at our end runs a mail server.

---

## 0. Prices not verified yet: check these before quoting

This cloud environment's network policy blocks the providers' pricing pages
(migadu.com, purelymail.com, zoho.com, workspace.google.com, hostinger.com,
hetzner.com all refused through the proxy; Microsoft's pricing pages
returned 503). Each figure below is tagged with its source:

| Tag | Meaning |
|---|---|
| **[F]** | Fetched from the vendor's own page or repo. Verified. |
| **[S]** | Search snippet from the vendor's domain. Page not opened, so **unverified**. |
| **[3P]** | Third-party sources only (reviews, other people's code). **Unverified.** |
| **[K]** | Prior knowledge. **Unverified.** |

Before putting a price in front of a client, open these pages and correct
the tables below (about 10 minutes from any normal browser):

- [ ] https://www.migadu.com/pricing/: plan prices and **outgoing messages/day** per plan
- [ ] https://purelymail.com/pricing and https://purelymail.com/advancedpricing
- [ ] https://www.zoho.com/mail/zohomail-pricing.html (Mail Lite 5 GB / 10 GB; set the region to Paraguay)
- [ ] https://www.zoho.com/mail/email-partnership-program.html (partner discount)
- [ ] https://www.hostinger.com/business-email (renewal price, not the intro price)
- [ ] https://workspace.google.com/pricing
- [ ] https://www.microsoft.com/en-us/microsoft-365/exchange/exchange-online-business-plans-and-pricing

---

## 1. Summary

1. **Don't self-host. Confirmed.** See §3.7. The cost isn't the server.
   New IPs start with no reputation. Hetzner blocks port 25 by default
   [S], and Hostinger VPS caps outgoing mail at 5 per minute [S]. On top of
   that come blacklist monitoring, spam filtering, backups and abuse
   handling, which make it an ongoing ops job we'd be selling for about a
   dollar a mailbox.
2. **Build on Migadu first**, behind a provider interface.
   - One flat account covers unlimited domains and mailboxes [S].
   - It has a real admin API that returns each domain's DNS records and
     has a DNS diagnostics endpoint [3P].
   - Its own site says it is built for agencies hosting clients' domains [S].
3. **The catch with Migadu:** its daily outgoing quota is **shared across
   the whole account** [3P]. At 150 mailboxes we'd need the Maxi plan
   (~$990/yr, about $0.55 per mailbox per month) [3P], or pay overages. That
   is still the cheapest option that automates cleanly.
4. **Purelymail is cheaper and the easiest to automate** (almost every DNS
   record is the same for every domain), but it's too risky to resell to
   paying clients:
   - it's a very small operator [K];
   - resale is neither allowed nor forbidden anywhere we could see [S];
   - it switches to metered pricing at our volume [S].
   Keep it as a fallback, not the base.
5. **Zoho Mail Lite through the Zoho partner program** is the second
   adapter, for clients who want Outlook/phone sync (ActiveSync) or a brand
   they recognise.
   - About $1 per user per month [3P], less the partner commission [S].
   - Has an official partner portal and API for creating client orgs [S].
6. **Google Workspace and Microsoft 365** cost 4–7× more.
   - Both need formal reseller status: Google's reseller contract, or
     Microsoft CSP through a distributor [S].
   - Microsoft Graph can't set aliases [F].
   Offer them only as "we'll set it up for you" jobs, not self-service.
7. **Hostinger Business Email** can't be fully automated. Its API can
   create mailboxes but has **no endpoint to add a domain or read its DNS
   records** [F], so every new client domain needs a manual hPanel step.

---

## 2. Cost comparison

Figures are USD per year. "Small" = 1 client × 3 mailboxes. "Scale" = 50
clients × 3 mailboxes = 150 mailboxes on 50 domains.

| Provider | Price model | Small | Scale | Notes |
|---|---|---|---|---|
| Migadu | Flat per account | $19 (Micro) [3P]; realistically $90 (Mini) [3P] | $290 Standard [3P] is too little send quota; **~$990 Maxi** [3P] | Micro sends only 20/day for the whole account; Standard 500/day [3P] |
| Purelymail | $10/yr + usage | $10 [S] | Metered pricing (storage rate unverified) | ~3,000/day send cap per account [S] |
| Zoho Mail Lite 5 GB | Per user, **billed yearly** [S] | $36 [3P] | $1,800 before partner commission [3P] | 10 GB tier is ~25% more [K] |
| Hostinger Business Email Starter | Per mailbox, multi-year prepay | $57 at renewal ($21 intro) [S] | $2,862 at renewal, as 50 separate orders [S] | 1,000 sends/day **per mailbox** [S] |
| Microsoft Exchange Online Plan 1 | Per user | $144 [S] | $7,200 [S] | Business Basic is $7/user/mo from 2026-07-01 **[F]**: $252 / $12,600 |
| Google Workspace Business Starter | Per user | $252 (annual) [S] | $12,600 [S] | Flexible (monthly) plan is $8.40 [S] |
| Self-hosted Mailcow | VPS | ~€120 [S] | ~€150–350 + relay + our time | Needs 8 GB RAM for ~10 users, 16 GB for heavy phone use **[F]** |

**What we'd charge.** A Migadu Maxi account costs about $0.55 per mailbox
per month at 150 mailboxes [3P]. At 10–30 mailboxes (a Mini or Standard
account), a price of Gs. 15.000–20.000 per mailbox per month (billed with
the 3/6/12-month prepay) covers the cost with margin. Anton sets the final
price.

---

## 3. Provider details

### 3.1 Migadu (recommended first adapter)

- **API:** REST at `https://api.migadu.com/v1/`. HTTP Basic auth: username
  is the admin email, password is an API key from My Account → API Keys
  [3P].
  - Domains: create, update, activate.
  - `GET /domains/{domain}/records` returns the DNS records that domain needs.
  - Diagnostics endpoint for a DNS check.
  - Full create/read/update/delete for mailboxes, aliases, identities and
    forwardings.
  - Endpoints come from third-party clients; the official docs at
    migadu.com/api were blocked.
- **DNS:**

  | Record | Value | Same for every domain? |
  |---|---|---|
  | MX | `aspmx1.migadu.com` (10), `aspmx2.migadu.com` (20) | Yes |
  | SPF | `v=spf1 include:spf.migadu.com -all` | Yes |
  | DKIM | 3 CNAMEs: `key{1,2,3}._domainkey` → `key{N}.<domain>._domainkey.migadu.com` | Pattern (derivable) |
  | Verification | TXT `hosted-email-verify=<code>` | **No**, read it from `/records` |
  | DMARC | TXT at `_dmarc` | We choose it |
  | Autoconfig | SRV records for `_imaps`, `_submissions`, `_autodiscover` | Yes |

  Source: [3P], taken from real zone files.
- **Clients:** IMAP, POP, SMTP, webmail, CalDAV/CardDAV. **No ActiveSync**
  [K]. Phones connect over IMAP, which works in the iOS and Android mail
  apps and Gmail.
- **Delivery:** shared outbound IPs. Migadu runs a public IP-reputation
  monitor.
- **Backups:** not verified. Assume **no long-term backups** and tell
  clients so (see §5).
- **Reselling:** Migadu's own site says agencies hosting clients' email
  "under a single roof" are a main use case [S]. The terms page was
  blocked; read it before launch.

### 3.2 Purelymail (fallback)

- **API:** `POST https://purelymail.com/api/v0/<method>` with header
  `Purelymail-Api-Token` [3P]. Methods include `addDomain`, `createUser`,
  `getOwnershipCode` and routing rules.
- **DNS:** the same for every domain [3P]:
  - MX `mailserver.purelymail.com`
  - SPF `include:_spf.purelymail.com`
  - 3 DKIM CNAMEs → `key{1,2,3}.dkimroot.purelymail.com`
  - DMARC CNAME → `dmarcroot.purelymail.com`
  - one ownership TXT code for the whole account

  That's the simplest possible checklist.
- **Clients:** IMAP, POP, SMTP, Roundcube webmail, Sieve filters. No
  ActiveSync [K].
- **Risks:** single operator; resale terms unknown; accounts with heavy
  usage move to metered pricing [S].

### 3.3 Zoho Mail Lite + partner program (second adapter)

- **API:** Zoho Mail REST API with OAuth 2.0 [S].
  - Scopes `ZohoMail.organization.domains.*` and
    `ZohoMail.organization.accounts.*`.
  - Add a domain, then verify it by TXT, CNAME or HTML (`verifyDomainByTXT`
    and similar), add users and aliases.
  - Partner APIs create a separate org for each client under our partner
    account [S].
- **DNS:**
  - MX (`mx.zoho.com`, `mx2`, `mx3`) and SPF (`include:zohomail.com`): the
    same for every domain.
  - Verification TXT and DKIM TXT: **different for each domain**; fetch
    them from the API.
- **Clients:** IMAP, POP, **ActiveSync**, Zoho mobile apps, webmail [S].
  Archival and backup are Premium-only [S].
- **Billing:** yearly only on mail-only plans [S]. That fits our 3/6/12-month
  prepay, though the 3- and 6-month terms would have to absorb a yearly
  commitment.

### 3.4 Hostinger Business Email

- **API:** the official Hostinger API **[F]** covers the mailbox side: list
  mail orders, create and delete mailboxes, passwords, aliases, forwarders,
  auto-replies, logs. Tokens are scoped to one order.
- **The gap:** it has **no endpoint to attach a domain to a mail order or to
  read its DNS records** [F]. The billing API can buy the product, but
  "product-specific provisioning" has to be finished in hPanel [F].
- **DNS:** the same for every domain [3P]:
  - MX `mx1/mx2.hostinger.com`
  - SPF `include:_spf.mail.hostinger.com`
  - DKIM CNAMEs `hostingermail-{a,b,c}._domainkey`
- **Verdict:** fine for one-off manual setups (we already use Hostinger),
  but not for self-service.

### 3.5 Google Workspace

- **Price:** $7 per user per month on the annual plan [S].
- **API:** Admin SDK Directory API for users and aliases [K]. Selling it on
  requires the Reseller API, a signed reseller contract and Partner
  Advantage enrolment [S].
- **Terms:** direct customers may not resell [S].
- **DNS:** DKIM is generated in the admin console [K].
- **Verdict:** only as a managed "we set it up" job.

### 3.6 Microsoft 365

- **Price:** Exchange Online Plan 1 is $4 per user per month [S]. Business
  Basic rose to $7 on 2026-07-01 **[F]**.
- **API:** Microsoft Graph **[F]**.
  - `POST /users` creates a user; the licence is assigned separately.
  - `GET /domains/{id}/verificationDnsRecords`, then `POST .../verify`,
    then `GET .../serviceConfigurationRecords` returns the MX and SPF
    records.
  - **`proxyAddresses` (aliases) is read-only in Graph**; aliases need
    Exchange PowerShell.
- **Reselling:** requires CSP through a distributor [S].
- **Verdict:** same as Google.

### 3.7 Self-hosting (Mailcow or Mailu on a VPS): rejected

- The APIs are good **[F]**:
  - Mailcow: `X-API-Key` header; creates domains, mailboxes and aliases,
    and generates DKIM keys.
  - Mailu: Bearer token.
- Everything else is the problem:
  - A new VPS IP has no sending reputation.
  - Hetzner blocks ports 25 and 465 until you ask and they agree, case by
    case [S].
  - Hostinger VPS limits outgoing mail to 5 per minute [S].
  - Either way we'd end up paying for a relay (smarthost) anyway.
  - Mailcow needs 6–16 GB RAM **[F]**.
  - Backups, restore tests, blacklist delisting, updates and abuse
    complaints all land on us, for a product that sells for about a dollar
    per mailbox.
- **Conclusion:** the owner's instinct holds. Don't run a mail server.

---

## 4. DNS: what we generate and what we can set ourselves

### Records each client domain needs (Migadu)

1. The provider's records from §3.1: MX, SPF, DKIM, verification TXT and
   the autoconfig SRV records.
2. DMARC: we generate `v=DMARC1; p=none; rua=mailto:<reports-address>` at
   first, and move to `p=quarantine` once reports come back clean.

### Rules for merging with what's already in the zone

- **Only one SPF record is allowed at the domain root.** If the client
  already has one (common when the domain is on Hostinger web hosting),
  the checklist must show a **merged** record (for example
  `v=spf1 include:spf.migadu.com include:_spf.mail.hostinger.com ~all`),
  never a second one. Detect this by resolving the existing TXT records.
- **Resend doesn't conflict.** The existing `tenant_email_domains` flow
  (Resend, for CRM-sent email) puts its MX and SPF on the `send.`
  subdomain and its DKIM at `resend._domainkey`. It never touches the root
  MX.
- **DMARC is shared.** One `_dmarc` record covers both Resend and the
  mailbox provider, since both sign with DKIM on the client's domain.
- **Old MX records have to go.** If the domain already receives mail
  somewhere else, the checklist must say "remove these MX records". The
  switch isn't reversible without losing mail sent in the meantime, so it
  needs an explicit confirmation step.

### How the records get into the zone

- **The client manages DNS** (the default: `.com.py` domains registered at
  NIC.PY, DNS wherever): we show a copyable checklist and verify it live.
- **We manage DNS** (domains we registered or host, on Cloudflare or
  Hostinger DNS): a "Set records automatically" button that calls the DNS
  provider's API with a platform token. Cloudflare's DNS API is well
  known. Confirm Hostinger's DNS zone endpoints in `hostinger/api` before
  relying on them. This is phase 2, not the MVP.

### Live verification

- We run our own check in the job with `node:dns/promises` (`resolveMx`,
  `resolveTxt`, `resolveCname`, `resolveSrv`), compare each record to what
  we expect, and store a result per record.
- We also call Migadu's diagnostics endpoint as a second opinion before
  activating the domain.
- The UI shows each row as ✓ / ✗ / "propagating".

---

## 5. Backups, retention, clients, deliverability

- **Backups:**
  - Consumer mail providers generally don't restore mailboxes a user
    deleted. Assume Migadu and Purelymail don't either, until we've read
    their docs.
  - The client terms must say "mailbox content is the client's
    responsibility; deleted mail isn't recoverable".
  - Phase 3 option: a nightly IMAP backup job (imapsync to object storage)
    sold as a paid extra.
- **Retention on cancellation:** when a subscription lapses, **suspend**
  (block logins, keep mail) for 30 days, then delete. Don't delete as soon
  as it lapses.
- **Client apps:** IMAP/SMTP work everywhere, and Migadu has webmail.
  - After creating a mailbox, show the settings (server, port, TLS), a
    webmail link, and a QR code for phone setup.
  - Migadu publishes autoconfig/autodiscover SRV records [3P], so most mail
    apps configure themselves from the address alone.
- **Deliverability:**
  - Shared provider IPs are fine for normal business mail.
  - Bulk sends (newsletters, promotions) must go through VenderCRM's own
    email tools (Resend), **never** the mailboxes. They'd use up Migadu's
    shared daily quota and damage every client's reputation. Put that in
    the add-on's terms.

---

## 6. VenderCRM feature plan (for approval, not built)

### 6.1 Where it lives

- **Settings page:** `src/app/(app)/settings/correo/`, next to the existing
  `settings/negocio/` page.
  - `page.tsx`
  - `MailDomainSection.tsx`
  - `MailboxList.tsx`
  - `actions.ts`
- **Module:** `src/modules/mail/`
  - `provider.ts`: the interface.
  - `providers/migadu.ts` (later `providers/zoho.ts`).
  - `domains.ts`, `mailboxes.ts`: tenant-scoped services through
    `tenantDb(ctx)`, the same pattern as `modules/tenancy/email-domains.ts`.
  - `dns-check.ts`
  - `jobs.ts`: `mail.verify_domain`, polled through `lib/queue` the way
    `email.verify_domain` is (every 10 minutes for 72 hours, then `failed`).
- **Who can use it:** tenant `admin` role only. Superadmin/ops can do the
  same on a client's behalf via the existing tenant switch, for "we set it
  up for you" jobs.
- **Audit:** every create, delete, suspend and password reset goes through
  `modules/tenancy/audit.ts`.

### 6.2 Tables (new Drizzle schema file `src/db/schema/mail.ts`)

`tenant_mail_domains`

| Column | Type | Notes |
|---|---|---|
| `id` | char(26) | Primary key |
| `tenant_id` | char(26) | Indexed |
| `domain` | varchar(255) | Unique across tenants: a domain belongs to exactly one tenant |
| `provider` | enum `migadu` \| `zoho` | |
| `provider_ref` | varchar(100) | The provider's domain ID or name |
| `status` | enum | `pending_dns` \| `active` \| `suspended` \| `failed` \| `deleting` |
| `expected_records` | json | What the provider asked for, merged with our SPF/DMARC rules |
| `dns_check` | json | Last result per record: `{type, host, expected, found, ok}` |
| `last_checked_at`, `verified_at`, `suspended_at` | datetime | |
| `created_at`, `updated_at` | datetime | |

`tenant_mailboxes`

| Column | Type | Notes |
|---|---|---|
| `id` | char(26) | Primary key |
| `tenant_id` | char(26) | Indexed |
| `mail_domain_id` | char(26) | |
| `local_part` | varchar(64) | Unique together with `mail_domain_id` |
| `display_name` | varchar(120) | |
| `status` | enum | `active` \| `suspended` \| `deleting` |
| `quota_mb` | int | |
| `provider_ref` | varchar(100) | |
| `created_by_user_id` | char(26) | |
| `created_at`, `updated_at` | datetime | |

**No passwords are stored, not even encrypted.** On create or reset, the
app generates a password, sends it to the provider, and shows it **once**.
Migadu can alternatively email an invitation link so the user sets their
own password [K]; that's better if the API supports it.

Aliases (`tenant_mail_aliases`) and forwardings come in phase 2.

### 6.3 Plan limits and billing

- Add `limits.maxMailboxes` to the plan JSON and enforce it in
  `modules/tenancy/limits.ts`, like `maxEmailsPerDay`. The default is 0,
  so nothing changes for existing tenants.
- The add-on is billed per mailbox on the same 3/6/12-month prepay
  (`subscriptions` / `payments`). That fits the prepay-only rule in
  PLAN.md §1.2.
- Creating a mailbox above the limit shows an upsell message, not an error.

### 6.4 Provider credentials

- One platform-level Migadu account, so its credentials live in **env
  only**: `MIGADU_API_USER` and `MIGADU_API_KEY`, added to
  `src/lib/config/env.ts` as optional zod fields.
- Without them, the section behaves like the unconfigured-Resend case in
  `email-domains.ts`: it explains that mailboxes aren't enabled rather than
  crashing.
- Never stored in the DB and never sent to the client.
- If we ever let a tenant bring **their own** provider account, that token
  goes in the DB encrypted with `encrypt()` from `src/lib/crypto`
  (AES-256-GCM under `APP_ENCRYPTION_KEY`), exactly like WhatsApp tokens
  and site hook secrets (`modules/sites/settings.ts`). That's not planned.

### 6.5 Provider interface

```ts
interface MailProvider {
  createDomain(domain: string): Promise<{ ref: string; records: DnsRecord[] }>;
  getDomainRecords(ref: string): Promise<DnsRecord[]>;
  diagnoseDomain(ref: string): Promise<DnsCheck[]>;
  activateDomain(ref: string): Promise<void>;
  createMailbox(ref: string, localPart: string, name: string, password: string): Promise<{ ref: string }>;
  setMailboxPassword(domainRef: string, localPart: string, password: string): Promise<void>;
  suspendMailbox(domainRef: string, localPart: string): Promise<void>;
  deleteMailbox(domainRef: string, localPart: string): Promise<void>;
  deleteDomain(ref: string): Promise<void>;
}
```

Migadu calls, for each step [3P, confirm against the official docs]:

- **Add domain:** `POST /v1/domains`, then `GET /v1/domains/{d}/records`.
- **Verify:**
  1. Our DNS check.
  2. `GET /v1/domains/{d}/diagnostics`.
  3. Activate the domain.
- **Create mailbox:** `POST /v1/domains/{d}/mailboxes` with `local_part`,
  `name` and `password` (or the invitation method).
- **Reset password:** `PUT /v1/domains/{d}/mailboxes/{local_part}`.
- **Suspend:** the same `PUT` with sending and receiving disabled.
- **Delete:** `DELETE /v1/domains/{d}/mailboxes/{local_part}`.

### 6.6 What the client sees

1. **Correo → "Agregar dominio".** Type `sunegocio.com.py`. The app checks
   the domain isn't already taken, then warns if the domain already has MX
   records ("tu correo actual deja de recibir cuando cambies esto").
2. **DNS checklist.** A table with columns *Tipo · Nombre · Valor · Estado*
   and a copy button on each row, plus "Verificar ahora". The background
   job keeps re-checking. When everything is green, the domain becomes
   `active`.
3. **"Crear casilla".** Enter a name and the address part, e.g. `ventas`.
   The app shows the password once, with IMAP/SMTP settings, a webmail
   link and a QR code for phone setup.
4. **The mailbox list** has actions: reset password, suspend, delete (with
   confirmation), plus a quota bar showing `n / maxMailboxes`.

### 6.7 Phases

| Phase | Scope |
|---|---|
| 1 (MVP) | Migadu adapter; add domain; DNS checklist + live verification; create, reset, delete mailbox; plan limit; ops can act for a client |
| 2 | Aliases/forwarding; automatic DNS for zones we manage (Cloudflare/Hostinger); suspend on subscription lapse via the `subscription-warnings` cron |
| 3 | Zoho adapter for ActiveSync clients; paid IMAP backup add-on |

---

## 7. Decisions needed from Anton

1. Confirm **Migadu** as the first provider, after checking the prices in
   §0, especially outgoing messages per day by plan.
2. The **price per mailbox** for clients, and whether it's bundled into any
   plan.
3. Which Migadu plan to start on. Mini is enough for the first ~5 clients;
   upgrade as the send volume grows.
4. **Deletion policy on cancellation:** suspend for 30 days, then delete?
5. Whether a Zoho partner account is worth opening now or only when a
   client asks for Outlook/ActiveSync.
