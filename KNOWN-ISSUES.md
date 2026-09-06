# Known issues

Cross-phase items still open after wave 1 (P1–P7, PLAN.md §15.5/§15.8),
promoted from each phase's own `docs/log/pN.md`. None of these block a
deploy — every one is a deliberate deferral or a scale tradeoff, documented
at the time rather than fixed then and there because it was out of that
phase's Owns column or its exit criteria didn't ask for it. Fixing one is
fair game for whichever future phase touches that file next.

- **`contract_accepted` has no emitter yet** (P1). The automation trigger
  type exists so J5 (contracts + receipts) can wire it without a second
  migration, but a flow built on it today never fires.
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
