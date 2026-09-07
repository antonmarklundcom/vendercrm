# VenderCRM — Phase 2 SIFEN e-invoicing plan (`PLAN-SIFEN.md`)

> **Authored by Fable 5.1, 2026-09-06.** The dedicated Phase 2 plan PLAN.md
> §9 promised. It answers the two architecture questions S1 reserved for
> Fable (§2, §3), fixes the data model and facade contract that follow from
> them (§4), and sequences the build (§5). **It does not yet contain the
> fiscal field-level detail** — DE element names, code-table values, the
> exact QR payload, event windows — because this planning environment's
> egress proxy blocks `sifende.com.py` and the SET/DNIT Manual Técnico
> mirrors, and nothing fiscal is asserted here from memory. §6 lists every
> such item as a *Manual Técnico question* and §7 says how the fiscal
> sections get written. Locked decisions from PLAN.md §1.2 and §9 hold;
> nothing here reopens them. Opus builds, Fable specs and reviews, never
> builds (`phased-autonomous-build` §4.8).

---

## 0. Status and prerequisites

**What exists** (PLAN.md §9 S1, merged): `src/modules/sifen/` with the
módulo-11 check digit, the 44-digit CDC (compose/parse/verify), the three
code tables the CDC needs (`iTiDE`, `iTipCont`, `iTipEmi`), a facade whose
six operations throw `SifenNotImplementedError`, and `boundary.test.ts`
enforcing that the module imports nothing from `@/modules/*`, `@/db`,
`@/lib`, `@/components`, `@/app`, `@/worker` or `@/i18n`. No tables, no
migration, nothing in the app calls it.

**What the owner produces before S3** (PLAN.md §15.2's list, restated as
the gate for each phase in §5):

| # | Prerequisite | Gates |
|---|---|---|
| 1 | RUC active, business enrolled in Marangatu with e-Kuatia access | S5 (test-environment credentials come from here) |
| 2 | Certificado de firma digital from an accredited PSC, issued to the emitting business | S4's live check (S4's code runs against a self-signed test certificate first) |
| 3 | Timbrado electrónico for the establecimiento / punto de expedición that will emit | S7 habilitación; S2's state machine is built against synthetic ranges |
| 4 | The current Manual Técnico + the test-environment endpoints and credentials, delivered from the owner's machine | S3, S4 (SIFEN's signing profile), S5, S6, S7 — every fiscal section of this file |
| 5 | A tenant willing to run the habilitación cycle | S7 |

**The platform's own business is a tenant.** §15.2 says the engine's first
customer is VenderCRM's own subscription invoice. A certificate and a
timbrado belong to a legal issuer, and in this system an issuer is a tenant
row (its certificate encrypted per §3.4, its timbrados in its scope). So
superadmin billing issues facturas *through the owner's own tenant* via
`modules/invoicing`, under a system tenant context (`buildSystemTenantContext`
already exists for the worker). No platform-level fiscal tables.

---

## 1. Boundary, restated as it is tested

The S1 test is the spec: **the engine imports nothing app-shaped.** Anything
it needs from the host — rows, secrets, the network, the clock — arrives as
a function argument. Extraction into the standalone e-invoicing SaaS later
means lifting `modules/sifen/` and its tables behind an HTTP API; the
adapters described in §2 are exactly the code that would be rewritten on the
other side of that API, and nothing else is.

Node built-ins (`node:crypto`, `node:buffer`) and plain npm packages (an
XML builder, an XMLDSig implementation) are allowed inside the engine — the
test only checks `@/` imports — but each npm dependency is a choice recorded
in §5's phase log, because the standalone service inherits it.

`modules/invoicing/` is the CRM side: it may import anything the rest of
the app may, it owns the invoice UI, quote→factura and nota→factura
conversion, tenant certificate and timbrado admin, and every adapter in §2.
It is subject to §3.3's isolation suite like any tenant module.

---

## 2. Question 1 — persistence without importing tenancy

**Decision: three injected ports, owned and implemented by
`modules/invoicing/`; the engine defines the interfaces and the domain types,
and never sees a tenant id.**

### 2.1 The ports (TypeScript interfaces in `modules/sifen/ports.ts`)

```ts
// Opaque to the engine: a tenant id in the host app today, an account id
// behind the HTTP API tomorrow. Never parsed, never logged in full.
type IssuerRef = string & { readonly __brand: "IssuerRef" };

interface SifenStore {
  // timbrados / numbering (§3)
  getTimbrado(issuer, id): Promise<SifenTimbrado | null>;
  listActiveTimbrados(issuer, docType): Promise<SifenTimbrado[]>;
  allocateNumber(issuer, timbradoId, fn: (t) => DocumentDraft): Promise<AllocatedNumber>;
  //   ↑ runs `fn` inside the store's own transaction with the timbrado row
  //     locked FOR UPDATE, increments next_number, inserts the document row as
  //     `reserved`, and commits both — the engine states the invariant, the
  //     adapter supplies the transaction (§3.2).
  updateTimbradoStatus(issuer, id, status): Promise<void>;
  // documents
  getDocument(issuer, id): Promise<SifenDocument | null>;
  getDocumentByCdc(issuer, cdc): Promise<SifenDocument | null>;
  transition(issuer, id, from: DocState, to: DocState, patch): Promise<boolean>;
  //   ↑ compare-and-set on `status`, returns false when `from` no longer
  //     matches — the same pattern as `claimWaitingRun` in the automation
  //     engine, for the same reason (two workers, one row).
  listDocuments(issuer, filter): Promise<SifenDocument[]>;
  // events and submissions
  appendSubmission(issuer, docId, attempt): Promise<void>;
  appendEvent(issuer, docId | null, event): Promise<SifenEvent>;
  listPendingInutilizations(issuer): Promise<SifenNumberGap[]>;
}

interface SifenKeyring {
  // Returns PEM material in memory for the duration of one signing call.
  // The adapter decrypts (lib/crypto, §3.4) and the engine never persists.
  load(issuer): Promise<{ certificatePem: string; privateKeyPem: string; notAfter: Date }>;
}

interface SifenTransport {
  // SOAP over HTTPS to SIFEN (sync, batch, query, event endpoints).
  // Injected so the unit suite runs against a recorded fixture and S5's
  // integration suite against the test environment, never production.
  call(endpoint: SifenEndpoint, envelope: string, opts: { timeoutMs }): Promise<{ status: number; body: string }>;
}

type SifenPorts = { store: SifenStore; keyring: SifenKeyring; transport: SifenTransport; now?: () => Date };
```

Every facade function takes `ports: SifenPorts` and an `issuer: IssuerRef`
as its first two arguments. `now` is injectable for the same reason
`slots.ts` and `alerts.ts` take a clock: the windows in §3 are testable
without waiting.

### 2.2 Where the tables live, and who owns their meaning

- **Drizzle definitions**: `src/db/schema/sifen.ts`, because drizzle-kit
  generates migrations from that directory and nowhere else. The engine
  never imports it. The file's header comment says so, and names this
  section.
- **Domain types**: `modules/sifen/types.ts` — `SifenTimbrado`,
  `SifenDocument`, `SifenEvent`, `DocState`, … These are what the ports
  speak. The adapter maps rows ↔ domain types in one place.
- **The adapter**: `modules/invoicing/sifen-store.ts` implements
  `SifenStore` over `tenantDb(ctx)` / `tenantTransaction(ctx)`. It is
  constructed per call as `sifenPortsFor(ctx)`, which **closes the tenant
  scope inside the adapter**: `issuer` is derived from `ctx.tenantId` and
  the adapter refuses a mismatch, so a caller cannot hand the engine one
  tenant's ports and another tenant's issuer. The engine therefore inherits
  §3.3 layer 2 without importing it.
- **Tests as spec** (§3.3 layer 3): `modules/invoicing/isolation.test.ts`
  creates two tenants and asserts every adapter method cannot read or
  mutate across them. `modules/sifen/**` tests use an in-memory
  `SifenStore` (a Map-backed implementation shipped under
  `modules/sifen/testing/`) so the engine's own suite has no database at
  all — the extraction test made concrete.

### 2.3 What this buys on extraction day

The standalone service ships its own `SifenStore` over its own database,
its own keyring over its own secret store, and the same transport. The
engine, its types, its state machines and its tests move unchanged. The
HTTP API is a thin layer that turns an authenticated account into an
`IssuerRef` and calls the same facade. Nothing in `modules/sifen/` is
rewritten — which is the definition of a clean seam.

---

## 3. Question 2 — timbrado and numbering: two state machines

### 3.1 The range (`sifen_timbrados`)

One row = one (timbrado, establecimiento, punto de expedición, document
type `iTiDE`) with `valid_from`, `valid_to`, `range_start`, `range_end`,
`next_number`, `status`. Fields are 8-digit timbrado, 3-digit
establecimiento, 3-digit punto, 7-digit número — the layout S1's
`CDC_FIELDS` already encodes; whether SET assigns an explicit numbering
range or the full `0000001–9999999` is a Manual Técnico question (§6),
so both are representable and `range_end` is never assumed.

```
            register
  ─────────────────────▶ active
                          │  next_number > range_end      ──▶ exhausted
                          │  now > valid_to               ──▶ expired
                          │  admin closes (new timbrado)  ──▶ closed
```

- Only `active` allocates. `exhausted`, `expired` and `closed` still accept
  *events* on documents already issued under them (a cancellation of last
  week's factura must not fail because the timbrado rolled over).
- Two ranges for the same (establecimiento, punto, type) may overlap in
  time during a rollover; allocation picks the `active` one with the
  earliest `valid_to`, so the older range drains first.
- Expiry is checked at allocation time against `now()`, and a daily
  `sifen.timbrado_sweep` job flips the status so the UI and the coach can
  see it before the first refused invoice. Coach L1 (PLAN.md §15.3) gets a
  "timbrado vence en N días / rango al 90 %" row in S8.

### 3.2 The number (`sifen_documents.status`)

A number is taken **at issue, never at draft** — the invoice draft lives in
`modules/invoicing`'s `invoices` table with no fiscal number, exactly as
`documents` moves `draft → issued`. Issuing calls `allocateNumber`, which
runs one transaction: lock the timbrado row `FOR UPDATE`, read
`next_number`, write `next_number + 1`, insert the `sifen_documents` row as
`reserved` with the number and the CDC. If the range is not `active` the
transaction refuses with a typed error and nothing is written.

```
 reserved ──generateDE──▶ generated ──signDE──▶ signed ──submit──▶ submitted
    │                        │                    │                   │
    │                        │                    │       ┌───────────┴───────────┐
    │                        │                    │   approved                rejected
    │                        │                    │       │                       │
    │                        │                    │  submitEvent(cancelación)  policy: reuse | inutilizar
    │                        │                    │       ▼                       │
    │                        │                    │   cancelled                   ▼
    └──── policy window elapsed without submit ──────────────────────────▶ to_inutilizar ──▶ inutilizado
```

Rules the engine enforces (each a unit test against the in-memory store):

1. **Every transition is a compare-and-set** (`store.transition(from, to)`);
   a lost race is a `SifenStateError`, never a silent overwrite.
2. **A gap is an event, never a skip.** A `reserved`/`generated`/`signed`
   number whose document has not reached `submitted` within the policy
   window (`SifenPolicy.inutilizeAfterHours`, default set by the Manual
   Técnico's own rule, §6) moves to `to_inutilizar`; `sifen.inutilizar`
   runs daily, groups consecutive numbers per timbrado into one
   inutilización event where the spec allows ranges, submits, and marks
   `inutilizado`. Until then the timbrado row reads *"N números sin
   reportar"* in the admin UI and the superadmin health page.
3. **Rejected is a policy fork, not a guess.** `SifenPolicy.onRejected` is
   `"reuse"` (the corrected DE is re-generated under the same number and CDC
   security code re-drawn if the spec requires) or `"inutilizar"` (the number
   goes to `to_inutilizar` and the corrected invoice takes a new one). The
   engine implements both; which one the Manual Técnico mandates is §6 Q4.
   Until answered, the default is `"inutilizar"` — the conservative reading,
   since an unreported gap is the error SET penalises, and a number burned
   by over-reporting is not.
4. **Cancellation is an event on an approved document within the spec's
   window** (§6 Q5); after the window the document stays `approved` and
   the correction is a nota de crédito (a new document, `iTiDE` for it,
   S3). The engine refuses `submitEvent(cancelación)` outside the window
   with the window in the error, so the UI can say why.
5. **A number is never re-used across timbrados** and never re-allocated
   after `inutilizado`; the unique index `(tenant_id, timbrado_id, number)`
   is the backstop behind the lock, as `document_sequences` has one.

### 3.3 Contingency

`iTipEmi` (normal vs contingencia) is inside the CDC, so the emission mode
is fixed at `generateDE`, before signing. Policy: normal by default; a
tenant admin (or the superadmin) flips **`contingencyMode: on`** for the
issuer explicitly, or the engine flips it automatically after
`SifenPolicy.contingencyAfterFailures` consecutive transport failures on
the sync endpoint (default 3, within 15 minutes) and clears it on the next
success. In contingency the document is still signed, the KuDE still goes
to the customer, and the submission is a `sifen.submit` job on the §2.1
queue with backoff — the Manual Técnico's deadline for submitting
contingency documents (§6 Q6) becomes `SifenPolicy.contingencySubmitWithinHours`
and is surfaced as a coach row and a health alert when at risk.

### 3.4 Certificates (`sifen_certificates`)

One row per issuer: PKCS#12 or PEM material encrypted at rest with
`lib/crypto` (§3.4 of PLAN.md — ciphertext/iv/tag, exactly as WhatsApp
tokens), `not_before`, `not_after`, `subject`, `serial`, `status:
active | expired | revoked`. The keyring adapter decrypts per signing call
and holds nothing. Expiry is a coach row 30 days out and an allocation-time
refusal after `not_after` (a document signed with an expired certificate is
a rejection waiting to happen — refuse early, at issue).

---

## 4. Data model and facade contract

### 4.1 Engine tables (`sifen_*`, defined in `src/db/schema/sifen.ts`, meaning owned by `modules/sifen`)

- `sifen_certificates` — §3.4.
- `sifen_timbrados` — §3.1, plus `establecimiento`, `punto_expedicion`,
  `doc_type`, indexes `(tenant_id, status)`, unique
  `(tenant_id, timbrado, establecimiento, punto_expedicion, doc_type)`.
- `sifen_documents` — `tenant_id`, `timbrado_id`, `number`, `cdc` (44,
  unique per tenant), `doc_type`, `emission_type`, `status` (§3.2),
  `de_xml_storage_key` (the signed XML lives in object storage, not in a
  column — it is large and immutable), `kude_storage_key`, `sifen_protocol`
  (the approval id SET returns), `sifen_response` json (last response,
  codes and messages), `issued_at`, `submitted_at`, `resolved_at`,
  `invoice_id` (**a pointer back to `invoicing`'s row — stored as an opaque
  string the engine never dereferences**; the CRM side joins on it).
- `sifen_submissions` — one row per attempt: `document_id`, `kind`
  (`sync | batch | query | event`), `request_storage_key`,
  `response_storage_key`, `http_status`, `result_code`, `attempted_at`.
  The audit trail for "what did we send SET, and when".
- `sifen_events` — `document_id?` (null for an inutilización of a never-used
  number), `kind` (`cancelacion | inutilizacion | …` per the Manual
  Técnico's event list, §6 Q7), `status`, `payload_storage_key`,
  `sifen_response` json, `range_from/range_to` for inutilización ranges.

### 4.2 CRM-side tables (`modules/invoicing`, `src/db/schema/invoicing.ts`)

- `invoices` — the draft and its commercial content: `tenant_id`,
  `contact_id`, `quote_id?`, `document_id?` (the nota de venta it
  formalises — PLAN.md §4 and §10 1Q allow the reference; the boundary
  comment on `documents` forbids the reverse), `status`
  (`draft | issued | void`), totals in integer minor units, IVA breakdown
  per rate (**the rates and their codes are §6 Q8**), `sifen_document_id`
  once issued, `pdf_storage_key` (the KuDE copy the CRM sends).
- `invoice_items` — description, qty, unit price, IVA rate code, line
  total; a copy by value from the quote/nota exactly as 1Q copies quote
  lines.
- `contacts.ruc` — the proper column PLAN.md §4 said Phase 2 adds; with a
  módulo-11 check at write via `parseRuc` from the facade (allowed — the
  CRM side may import the engine). `contacts.custom.ruc` values migrate
  into it once.
- `invoice_sequences` is **not** a table: the fiscal number *is* the
  sequence, and it lives in `sifen_timbrados`.

Money stays integer minor units (PLAN.md §2.3); IVA arithmetic is added to
`lib/money.ts` as pure functions with the rounding rule the Manual Técnico
states (§6 Q8), unit-tested against the Manual's own worked examples once
they can be read.

### 4.3 The facade, made concrete (signatures replace S1's `never`s)

```ts
generateDE(ports, issuer, input: DeInput): Promise<{ documentId; cdc; xml }>      // reserved → generated
signDE(ports, issuer, documentId): Promise<{ signedXml }>                          // generated → signed
submit(ports, issuer, documentId | documentId[], mode: "sync" | "batch"): Promise<SubmitResult> // signed → submitted → approved|rejected
queryStatus(ports, issuer, cdc): Promise<StatusResult>                             // no transition unless SET says so
generateKuDE(ports, issuer, documentId): Promise<{ pdf: Buffer; qrPayload }>       // approved (or contingency-signed)
submitEvent(ports, issuer, event: CancelacionInput | InutilizacionInput | …): Promise<EventResult>
```

`DeInput` is the engine's own typed shape — issuer data, receiver data,
items with IVA codes, totals, timbrado id — which `modules/invoicing`
builds from an `invoices` row. The XML element names behind it are S3's
work and §6's questions; the *shape* is fixed now so `invoicing` can be
built against it in S2.

---

## 5. Phases

Opus for every S phase (PLAN.md §1.3: the SIFEN engine is Opus work);
Sonnet only for S8's UI half. One PR per phase, `phase/<id>`, the
`phased-autonomous-build` mechanics and `prompts/_handoff-p.md`. Fable
appears only where marked.

| Phase | Scope | Gate | Where |
|---|---|---|---|
| **S1** ✅ | dv, CDC, three code tables, facade shape, boundary test | — | merged (PLAN.md §9) |
| **S2** — ports, tables, state machines | §2 ports + in-memory store; `sifen_*` and `invoicing` tables + migration; the two state machines with their unit tests; `sifen-store.ts` adapter + isolation suite; certificate upload/encrypt and timbrado registration under `/invoicing/settings` (admin only); `contacts.ruc`; `sifen.timbrado_sweep` and `sifen.inutilizar` jobs *with the submit step stubbed*; the "Factura electrónica — Próximamente" nav item **unchanged** | none — verifiable without the Manual Técnico | **wave 2 lane 1, P11** (PLAN.md §17.2) |
| **S3** — DE generation | `DeInput` → XML per the Manual; every code table; totals/IVA rules; golden-file tests from the Manual's examples | prerequisite 4 | after wave 2 |
| **S4** — signing + keyring | XMLDSig with SIFEN's profile (which element, transforms, digest/signature algorithms — §6 Q2) over the keyring port; built and tested against a self-signed certificate; live check with the real one | 4 for the profile; 2 for the live check | after S3 |
| **S5** — transport + test environment | SOAP envelopes, sync/batch/query, response-code mapping, `sifen_submissions`, contingency flip; integration suite against the test environment, recorded fixtures for CI | 1, 4 | after S4 |
| **S6** — KuDE + QR | KuDE PDF over `renderable-document`'s shell where the layout allows (Fable review: a fiscal representation may need its own template), QR payload per §6 Q3, delivery by WhatsApp/email through the existing paths | 4 | after S5 |
| **S7** — events + habilitación | cancelación, inutilización live, the other events the Manual lists; the habilitación runbook in `docs/SIFEN-HABILITACION.md`; the tenant's test cycle | 3, 5 | after S6 |
| **S8** — CRM integration (Opus engine side, Sonnet UI) | quote→factura, nota→factura, invoice list/detail/issue/void UI, superadmin subscription invoices through the owner's tenant, coach rows (§3.1, §3.4), the nav item finally enabled and the "próximamente" copy removed **only after S7 passes** | S7 passed | last |

**Sequencing against wave 2** (PLAN.md §17.4): S2 is inside wave 2 because
it needs no owner input and overlaps no other phase's files. S3–S8 are
fully after wave 2 *and* after the prerequisites; they do not wait for each
other's owner items beyond what the table says. The owner-side lead time
(certificate, timbrado, credentials) is the critical path, not the build.

---

## 6. Manual Técnico questions — the list this file refuses to guess

Each is answered in a later revision of this file by quoting the Manual
Técnico (version and section), on a machine that can read it.

1. **DE structure**: the exact element tree under the root (the groups the
   S1-era references describe — operation, timbrado, general data, issuer,
   receiver, document-type-specific block, items, totals, associated
   documents, signature) and which are mandatory per `iTiDE`.
2. **Signing profile**: which element the signature covers, canonicalisation,
   digest and signature algorithms, where the `Signature` element sits, and
   the certificate requirements (key usage, PSC list).
3. **KuDE and QR**: mandatory KuDE content and the QR URL/parameter layout,
   including any hash of the signature it embeds.
4. **Rejected numbers**: may a rejected DE be corrected and resent under the
   same number, or must the number be inutilizado (§3.2 rule 3).
5. **Cancellation window** after approval, and what replaces cancellation
   outside it (§3.2 rule 4).
6. **Contingency**: the submission deadline for contingency-issued
   documents and any batch-size rules (§3.3).
7. **Event catalogue**: the full list of issuer-side events and their
   payloads; receiver-side events (conformidad, disconformidad,
   desconocimiento, notificación) — in or out of scope for a tenant that
   also *receives* facturas.
8. **IVA**: the rate codes, the exempt/partial cases, the rounding rule for
   totals in guaraníes, and whether USD-denominated documents carry an
   exchange rate field.
9. **Numbering ranges**: whether SET assigns an explicit range per timbrado
   or the full seven digits are usable; whether ranges may be extended.
10. **Endpoints and environments**: the test and production service URLs,
    timeouts, and the batch (lote) size limits.
11. **Document types in scope for launch**: factura electrónica, nota de
    crédito/débito, autofactura, and which the owner's own business needs
    first (the subscription invoice is a factura).

---

## 7. How the fiscal sections get written

A Fable session opened by the owner **on a machine where the Manual
Técnico and the test-environment documentation are readable**, or with
those documents committed under `docs/sifen/` first (PDF is fine —
`Read` handles it) so a cloud session can read them. That session fills
§6, turns the answers into S3–S7's phase prompts, and is the only Fable
involvement between S2 and the post-S7 review. It must not start the build
sessions itself (`phased-autonomous-build` §4.8).

## 8. Explicitly not in Phase 2

Receiving other businesses' facturas into the CRM (receiver events, §6
Q7) unless the Manual makes it trivial; a PSEC/third-party fallback
(§1.2 locks in-house); multi-currency accounting beyond what the DE
requires; the standalone SaaS extraction itself (§9 of PLAN.md: keep the
boundary clean, don't build the split now).
