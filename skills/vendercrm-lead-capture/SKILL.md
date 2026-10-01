---
name: vendercrm-lead-capture
description: Wire a website's contact/quote/booking form so its submissions land in VenderCRM as contacts and pipeline deals, via the tenant-scoped POST /api/v1/leads endpoint. Use this skill whenever you are building, editing, or debugging a lead form on a site whose leads belong in VenderCRM — including phrasings like "hook the contact form up to my CRM", "send leads to VenderCRM", "the form submits but nothing shows up in the pipeline", "add a quote request form to this client site", or any work on a contact form for a site the user owns and sells from. Also use it when adding WhatsApp-first contact forms to Paraguayan or Swedish local-business sites the user runs, since those leads are meant to reach VenderCRM. Covers static HTML+PHP, Node.js/Express, Next.js and WordPress.
---

# VenderCRM lead capture

Connect a site's form to VenderCRM so each submission becomes a contact — and,
when the site is configured for it, an open deal in the right pipeline stage.

## The one architectural rule

**The browser never talks to VenderCRM.** The form posts to the site's own
server; that server posts to VenderCRM with the site's API key.

```
visitor → [form] → site's own handler → VenderCRM /api/v1/leads
                    (holds the key)
```

The endpoint deliberately sends no CORS headers, so a browser `fetch` to it
fails by design. That is not an obstacle to work around — it is the thing that
keeps the API key out of page source. A key in client-side code lets anyone
write into the customer's pipeline, and rotating it means editing every site
that shares it.

If the site is pure static hosting with no server at all, don't invent one:
skip to [Sites with no backend](#sites-with-no-backend).

## Before writing code

Get these two from the user (both come from VenderCRM → **Sitios**):

1. **CRM base URL** — e.g. `https://crm.sudominio.com`
2. **Site API key** — created per site, shown exactly once

One key per site, never shared between sites. That is what makes per-site and
per-campaign lead reporting work, and it means one compromised site can be cut
off without touching the others.

Store the key in the site's server environment as `VENDERCRM_API_KEY`. Never in
HTML, never in client JS, never committed.

## The endpoint

`POST {CRM_URL}/api/v1/leads`
Headers: `Content-Type: application/json`, `X-Api-Key: <site key>`

| Field | Required | Notes |
|---|---|---|
| `phone` | **yes** | 6–30 chars. Contact identity. Local Paraguayan input (`0981 123 456`) is normalized to `+595981123456` server-side |
| `idempotency_key` | **yes** | 8–100 chars. Replaying it returns the original result instead of creating a duplicate |
| `name` | no | ≤200 |
| `email` | no | ≤320. An address that does not parse is still accepted: kept on the lead as typed, not set on the contact, flagged for review |
| `message` | no | ≤5000 |
| `source` | no | ≤100. Defaults to `site:<site-slug>` |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | no | ≤200 each |
| `gclid`, `fbclid` | no | ≤200 |
| `page_url`, `referrer` | no | ≤2000 |
| `fields` | no | Object. Anything else worth keeping on the timeline — `{"servicio": "ortodoncia", "presupuesto": "5-10M"}`. Up to 100 keys, each string ≤5000 |

Only `phone` and `idempotency_key` are strict. An optional value over its
limit no longer fails the lead: it is truncated, the original is kept on the
submission, and the deal card shows a **Revisar** badge. Send custom fields
inside `fields` — that is the contract. Unknown top-level keys are accepted
and folded into `fields`, except credential-shaped names (`api_key`, `token`,
`password`, `secret`, ...), which are never stored. A body over 256 KB is
refused with `422`.

**Never send pipeline, stage, owner or tag.** Routing lives on the site record
inside the CRM, so the customer can re-route a site's leads without a code
change, and a leaked key can't redirect leads into another pipeline.

### Responses

| Status | Meaning | What the handler should do |
|---|---|---|
| `201` | Created. Body: `contactId`, `dealId`, `submissionId`, `duplicate:false` | Success |
| `200` | Idempotency key replayed. Same body, `duplicate:true` | Treat as success — this is the retry working |
| `401` | Missing or invalid key | Log loudly; the site is misconfigured |
| `403` | Site deactivated, or the CRM subscription lapsed into read-only | Log; tell the user to check **Sitios** / billing |
| `422` | Validation failed. Body says which field | Log the body — it names the field |
| `429` | Rate limited (60/min per site) | Log; back off |

## Six rules that decide whether this works in production

**1. Key server-side.** Covered above — the reason the whole architecture is
shaped this way.

**2. Always send `idempotency_key`.** Users double-click. Networks time out
after the write succeeded. Without a stable key, each of those becomes a
duplicate contact that a salesperson has to clean up. Derive it from data that
identifies *this* submission — phone plus the current hour works well, because
it collapses genuine double-submits while still letting the same person enquire
again tomorrow:

```
sha256(phone + "|" + YYYY-MM-DD-HH)
```

Use a per-submission UUID instead if the form already has one.

**3. Phone is required, and it is the identity.** A submission without a phone
cannot become a contact. Mark the field `required` in HTML, `type="tel"`, and
validate server-side too. Accept the local format people actually type —
`0981 123 456` — the CRM normalizes it.

**4. Stop spam at the site, not in the CRM.** A honeypot costs three lines and
removes most bot traffic:

```html
<input name="website" tabindex="-1" autocomplete="off"
       style="position:absolute;left:-9999px" aria-hidden="true">
```

If it arrives non-empty, redirect to the thank-you page and post nothing. On
sites with real traffic add Cloudflare Turnstile as well. Spam that reaches the
CRM costs the customer's attention every day; spam blocked at the form costs
nothing.

**5. Never block the visitor on the CRM.** Wrap the POST in try/catch with a
~10s timeout. If the CRM is unreachable, still show the thank-you page and log
the failure. A visitor who filled in a form and got an error page is a lost
customer; a logged error is a five-minute fix.

**6. Capture attribution.** Add the first-touch snippet to every page:

```html
<script src="{CRM_URL}/vc-attribution.js" defer></script>
```

It stores the first `utm_*` / `gclid` / `fbclid` the visitor ever arrived with
in a 90-day `vc_attr` cookie and never overwrites it — so someone who arrives
from a campaign today and converts next week is still credited correctly. Read
that cookie server-side and map it into the payload. Without this, every lead
looks like direct traffic and the customer can't tell which ads work.

## Implementation

Read the reference for the stack in play — each has a complete, paste-ready
handler with the six rules already applied:

| Stack | File |
|---|---|
| Static HTML + PHP (most Hostinger sites) | `references/php.md` |
| Node.js / Express | `references/node.md` |
| Next.js (App Router) | `references/nextjs.md` |
| WordPress (functions.php, CF7, WPForms) | `references/wordpress.md` |

The HTML form markup is the same everywhere and lives in `references/php.md`.

## Sites with no backend

Static hosting with no PHP or Node? Don't stand up a server just for this.
VenderCRM hosts the form itself:

```
{CRM_URL}/f/{tenant-slug}/{form-slug}
```

Link to it, or embed it in an iframe. Same contact, same pipeline routing, no
API key to manage. The customer builds the form in the CRM under **Formularios**.

Trade-off worth stating to the user: the hosted form can't be styled to match
the site, and it doesn't pick up the `vc_attr` cookie from their domain. For a
demo or a low-volume site that's usually fine; for a site running paid traffic,
the server-side handler is worth the extra step.

## Verify before calling it done

Do not tell the user it works because the code compiles. Confirm the round trip:

1. Submit the real form with a real phone number.
2. VenderCRM → **Contactos**: the contact is there, phone normalized to `+595…`.
3. If the site has a default stage configured, **Pipeline** shows the new deal.
4. **Sitios** shows the lead counted against this site.
5. Submit the identical form twice in a row — the second should *not* create a
   second contact. If it does, `idempotency_key` isn't stable.

## When leads aren't arriving

Work down this list — it's ordered by how often each is the actual cause:

1. **Check the site's server log first.** The handler swallows errors by design
   (rule 5), so the failure is in the log, not on screen. The response body
   names the problem.
2. `401` → key wrong, or `X-Api-Key` header not actually being sent. Confirm
   the env var is readable at runtime (`getenv` returning `false` is common on
   shared hosting).
3. `422` → the body names the field. Usually a missing or malformed `phone`,
   or `idempotency_key` shorter than 8 characters.
4. `403` → the site is deactivated in **Sitios**, or the customer's
   subscription lapsed and the account is read-only.
5. Nothing in the log at all → the form isn't reaching the handler. Check the
   form's `action` and method.
6. Contact appears but no deal → expected unless a default stage is set on the
   site in **Sitios**. That's CRM configuration, not a code bug.
