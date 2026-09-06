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
- **The notifications bell's unread count is computed in Node**, not with a
  SQL `COUNT(*)` (P1) — reads all of a user's recent rows to count them.
  Fine at the bell's current scale (ten rows).
- **A user removed from a tenant keeps their `push_subscriptions` rows**
  (P2). Nothing is delivered to them — the active-membership check refuses
  the send before it reaches their device — so this is dead weight, not a
  leak.
- **Web-chat conversations in `/inbox` have no filter or search of their
  own** (P3) — `?filter=` and `?q=` apply only to WhatsApp rows; only
  `/chat`'s own status filter narrows the web-chat ones.
- **`/u/[token]` (email unsubscribe) mutates on a plain GET** (P4) — the
  same pattern most one-click unsubscribe links use, but a mail client's
  link-prefetcher visiting it early can trigger a false unsubscribe.
- **Deleting a custom field definition leaves its values in
  `contacts.custom`** (P5) — dead JSON keys, harmless since nothing reads a
  key with no definition, but no cleanup pass exists.
- **`renderContactCustomVars` (custom-field template variables) is not
  wired into the automation template engine** (P5) — `{{contacto.custom.*}}`
  resolves in code but no flow action can reference it yet.
- **`expireQuotes` and `coach.morning`'s digest check each walk every tenant
  on the platform per run** (P6, P7) — correct and fine at current scale;
  would want a per-tenant cursor or batching if the tenant count grows by
  orders of magnitude.
- **The public quote accept/reject form has no CAPTCHA** (P6) — a per-IP
  rate limit (10/min) is the only abuse guard, the same posture the
  pre-existing `/q/[token]` view already had.
- **`negocio.*` template variables are not resolvable yet** (P13) — a
  contract template referencing one is refused at save with the variable's
  name. K3 was expected to register them but was skipped this wave (K2, its
  own dependency, has not merged) — still open until K2 and K3 both land.
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
- **`getSalesReport` runs twice per page load** (P15, current + previous
  window) — fine at today's per-tenant data volume.
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
- **K3 (memory imports, template variables, coach rows) was skipped
  entirely this wave** — its dependency K2 (Setup assistant, wave 2 lane 1)
  had not merged when the lane reached it. `memory_imports` and
  `setup_plans` (K1) remain created and unused until K2 and K3 both land.
