# VenderCRM ops API — `/api/ops/v1`

Every request sends `X-Ops-Token: $VCRM_OPS_TOKEN`. Bodies are JSON.

Errors share one shape:

```json
{ "error": { "code": "not_found", "message": "site not found" } }
```

| Status | Code | What it means for you |
|---|---|---|
| 401 | `unauthorized` | The token is missing, wrong, revoked or expired. Ask the owner for a new one; do not retry. |
| 404 | `not_found` | Not yours. The object may exist — the token simply cannot see it. Stop this row. |
| 409 | `conflict` | A name is taken (tenant slug, site slug) or the site already has two live keys. Fix the input or ask. |
| 422 | `invalid_request` | The body or the row is wrong, and the message says how. |
| 429 | `rate_limited` | 120 calls per minute per token. Wait and continue. |

Steps are idempotent per row: a repeat answers `200` with `"repeated": true`
and the object created the first time. A first-time create answers `201`.

---

## `GET /me`

```json
{
  "token": { "label": "PC del dueño", "prefix": "vc_ops_AbCd1234", "expires_at": null, "call_count": 41 },
  "allowed_tenants": [{ "id": "01J…", "name": "Red PY", "slug": "red-py" }],
  "open_batches": [{ "id": "01J…", "title": "dentista de Luque", "status": "open", "raw_text": null }]
}
```

`allowed_tenants` is the *only* place existing businesses appear, and it lists
just the ones the owner allowlisted for this token.

## `POST /batches`

```json
{ "title": "sitios de agosto", "raw_text": "opcional: la lista que pegó el dueño" }
```

→ `201 { "batch": { … } }`

## `GET /batches` · `GET /batches/{id}`

Own batches only, with their rows. `GET /batches/{id}` also returns
`raw_text` — the owner's pasted list, which **you** turn into rows; the server
never parses it.

## `POST /batches/{id}/rows`

```json
{
  "rows": [
    {
      "domain": "dentistaluque.com.py",
      "display_name": "Dentista Luque",
      "tenant_mode": "new",
      "details": {
        "admin_email": "dra.gimenez@dentistaluque.com.py",
        "admin_name": "Dra. Giménez",
        "tenant_name": "Consultorio Giménez",
        "tenant_slug": "consultorio-gimenez",
        "owner_email": "dra.gimenez@dentistaluque.com.py",
        "stages": ["Nuevo", "Contactado", "Presupuesto", "Ganado", "Perdido"],
        "tags": ["ortodoncia"],
        "wa_account_id": "01J…",
        "notes": "abre en septiembre"
      }
    }
  ]
}
```

`details` is strict: an unknown field is a 422, not a silent no-op. Every
field in it is optional except `admin_email` (required by the tenant step when
`tenant_mode` is `new`).

Set `tenant_mode: "existing"` **with** `tenant_id` to add a site to one of the
allowlisted businesses from `/me`. Any other tenant id answers 404.

## `PATCH /batches/{id}/rows/{rowId}`

Same fields, plus `needs_input` and `state`. `state` accepts only `pending`
and `needs_input` — a session cannot mark its own work approved.

## The five steps

| Step | Creates | Response |
|---|---|---|
| `POST /rows/{id}/tenant` | business + first admin (random password, reset e-mail sent, never returned) | `{ "tenant_id", "admin_user_id", "reset_email_sent", "repeated" }` |
| `POST /rows/{id}/site` | the site, **inactive**, slug from the domain's first label | `{ "site_id", "slug", "is_active": false, "repeated" }` |
| `POST /rows/{id}/pipeline` | pipeline + stages, missing tags, resolves `owner_email`, writes the site's routing defaults | `{ "pipeline_id", "stage_ids", "tag_ids", "owner_user_id", "repeated" }` |
| `POST /rows/{id}/key` | one API key. Optional body `{"label":"…"}` | `{ "api_key_id", "api_key": "vc_live_…", "repeated" }` — `api_key` is `null` on a repeat |
| `POST /rows/{id}/test-lead` | the fixed test lead; row → `awaiting_approval` | `{ "contact_id", "deal_id", "state", "repeated" }` |

Notes that matter in practice:

- **`stages` omitted** → the tenant's default stage set (Nuevo contacto,
  Contactado, Propuesta enviada, Negociación, Ganado, Perdido). Given
  explicitly, the stages are created exactly as written, in order, with no
  won/lost marking — say so to the owner if he asked for a custom set.
- **`owner_email` must already be a user in that business.** Right after the
  tenant step the only user is the admin you just created, so passing the same
  address is the normal case. An unknown address is a 422 naming it.
- **The site is inactive.** `/api/v1/leads` answers `403 Site is inactive`
  until the owner approves the row. That is expected — do not "fix" it.

## Row states

`pending` → `running` → `awaiting_approval` → `live` (the owner's click), with
`needs_input` and `failed` as the two places a row stops. A failed row keeps
`last_error: { step, status, reason }` verbatim, which is what the owner reads
on the page — so a good `needs_input` note saves him a round trip.
