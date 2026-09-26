# Known issues

Cross-phase items still open after wave 1 (P1–P7, PLAN.md §15.5/§15.8) and
wave 2 lane 2 (P13–P17, §17.2/§17.3), promoted from each phase's own
`docs/log/pN.md`. None of these block a deploy — every one is a deliberate
deferral or a scale tradeoff, documented at the time rather than fixed then
and there because it was out of that phase's Owns column or its exit
criteria didn't ask for it. Fixing one is fair game for whichever future
phase touches that file next.

- **`notify_user`'s notification always links to `/contacts/<id>`** (P1),
  never a deal- or document-specific URL, even when the automation step that
  created it fired from one of those.
- **Web-chat conversations in `/inbox` have no filter or search of their
  own** (P3) — `?filter=` and `?q=` apply only to WhatsApp rows; only
  `/chat`'s own status filter narrows the web-chat ones.
- ~~`/u/[token]` (email unsubscribe) mutates on a plain GET~~ — **fixed**:
  the page now only reads, and the opt-out is a POST behind a confirm
  button (`u/[token]/actions.ts`), so a link prefetcher can't trigger it.
- **Deleting a custom field definition leaves its values in
  `contacts.custom`** (P5) — dead JSON keys, harmless since nothing reads a
  key with no definition, but no cleanup pass exists.
- **`expireQuotes` and `coach.morning`'s digest check each walk every tenant
  on the platform per run** (P6, P7) — correct and fine at current scale;
  would want a per-tenant cursor or batching if the tenant count grows by
  orders of magnitude.
- **The public quote accept/reject form has no CAPTCHA** (P6) — accepted
  risk, not a gap: the link carries a 48-hex-char random token, a quote can
  be decided exactly once (status check + unique index), and a per-IP rate
  limit (10/min) sits in front. A CAPTCHA would only add friction for the
  customer accepting the quote.
- ~~`negocio.*` template variables are not resolvable yet~~ — **fixed by
  K3** (`docs/log/k3.md`): registered in `contracts/render.ts` and wired
  into the quote/nota de venta PDF footers.
- **No drawn-signature pad for contracts** (P13) — click-to-accept is the
  whole flow per §17.1 #5; `contract_acceptances.signature_storage_key`
  exists and nothing writes to it.
- **`sendContractByEmailAction` doesn't flip contract status or write its
  own timeline activity** (P13), separately from the WhatsApp send — the
  same precedent `sendQuoteByEmailAction` already set for quotes.
- **The WhatsApp `briefing_semanal` template is never submitted by P14** —
  an admin has to create and get it approved in Meta first; until then the
  WhatsApp copy of the weekly briefing is silently skipped.
- **`sendWeeklyBriefings` iterates every tenant on the platform once an
  hour** (P14), same posture and scaling caveat as `sendMorningDigests`.
- **No campaigns table in `/reports` yet** (P15) — resolved automatically
  once P10 (lane 1) merges and adds the fourth table.
- **The response-time distribution and stage funnel in `/reports` have no
  comparison column** (P15) — only the keyed tables (sources, sites) do.
- **The `/contacts` duplicates panel re-scans every contact on every page
  load** (P16) — fine at today's per-tenant contact volumes, an O(n²)
  pairwise comparison worth caching if that grows large.
- **No bulk "merge all found duplicates" action** (P16) — each pair is
  reviewed and merged one at a time, deliberately, since merges aren't
  reversible.
- **A ticked `consent_whatsapp` checkbox on a form does not stamp
  `contacts.wa_marketing_consent_at`** (P17) — that column doesn't exist on
  `main` yet (P10, lane 1, not merged when this phase ran). The `checkbox`
  field type still ships and a tenant can add the field today; wiring the
  actual consent write is a one-line follow-up once P10 merges.
- ~~K3 (memory imports, template variables, coach rows) was skipped
  entirely this wave~~ — **built** (`docs/log/k3.md`): `memory_imports` is
  now read/written by `/settings/negocio/importar`; `negocio.*` variables
  and the three memory-upkeep Hoy rows are live. `renderTemplateVars`
  (automations flow messages) still does not resolve `negocio.*` — K3
  scoped that out, see its log's decision 3.
- **Claude Ops tokens have no UI until O2** (O1) — `npm run create-ops-token`
  prints one, and cannot set an expiry or an allowlisted tenant; both are the
  console's to add. Nothing in the ops API deletes anything, so a
  half-provisioned row is finished, corrected or left alone by hand.
- **An ops-provisioned site carries one revoked `site_api_keys` row** (O1) —
  the key `createSite` issues automatically is revoked immediately, because
  its plaintext is discarded and the ops key step issues the one the website
  actually holds.
- **Explicit stage names given to the ops pipeline step are created without
  won/lost flags** (O1) — a custom set has no `is_won` stage until someone
  marks it in the CRM; omitting `stages` uses the flagged default set.
