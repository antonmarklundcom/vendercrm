---
name: vendercrm-ops
description: Provision the CRM side of a new website in VenderCRM from this session — create the business, its site (born inactive), pipeline, tags, API key and a test lead through the ops API, then hand the site to the owner for approval. Use this whenever a site you just built (or are about to launch) needs a CRM behind its lead form, whenever the user says "conectá el sitio al CRM", "create the business in VenderCRM", "provisioná el CRM", "set up the pipeline for this client", "necesito la API key del sitio", or after the vendercrm-lead-capture skill asks for a site API key you do not have yet. Requires VCRM_OPS_URL and VCRM_OPS_TOKEN in the environment; without them, stop and ask the owner for them rather than creating anything by hand in the CRM.
---

# VenderCRM ops — provisioning a site from this session

This is the CRM half of launching a website: business → site → pipeline →
API key → test lead. It ends with a site that is **not live yet**, waiting for
the owner's approval on `/claude-ops`.

Pair it with **vendercrm-lead-capture**, which wires the form itself. The key
this flow issues is what that skill calls `VENDERCRM_API_KEY`.

## What you need

Two environment variables on this machine:

```
VCRM_OPS_URL=https://crm.example.com
VCRM_OPS_TOKEN=vc_ops_…
```

If either is missing, **stop and ask the owner**. Do not sign into the CRM,
do not create anything through the UI, and do not invent a key.

Every call sends the token as a header:

```bash
curl -sS -H "X-Ops-Token: $VCRM_OPS_TOKEN" "$VCRM_OPS_URL/api/ops/v1/me"
```

## What this token can and cannot do

It is create-only, and blind to everything that existed before it:

- It **can** create a business and its first admin, a site, a pipeline with
  stages and tags, an API key, and one test lead.
- It **cannot** list, read or change any business, site, pipeline, contact,
  deal or key it did not create itself.
- It **cannot** read an existing site's key, and it **cannot** activate a
  site. Going live is the owner's click.
- In a business the owner has **allowlisted** (see `/me`), it may add a *new*
  site — and still sees nothing else in that business.

So a `404` does not mean "broken". It means "not yours". Do not try another
id, another endpoint, or the UI: write the reason on the row and tell the
owner.

## The flow

1. **`GET /me`** — confirm the token works and read `allowed_tenants`.
2. **Create a batch** (or reuse an open one from `/me`):
   `POST /batches` with `{"title": "dentista de Luque"}`. A batch is just a
   folder; one site is a perfectly good batch.
3. **Add one row per domain**: `POST /batches/{id}/rows`. The row carries
   everything the later steps read — admin e-mail, stages, tags, owner.
4. **Run the five steps in order**, each `POST /rows/{rowId}/…`:
   `tenant` → `site` → `pipeline` → `key` → `test-lead`.
5. **Put the key into the website**: the `api_key` in the key step's response
   is shown once. Write it into the site's server environment as
   `VENDERCRM_API_KEY` (never in HTML, never in client JS, never committed).
6. **Tell the owner**: "the site is provisioned and waiting for your approval
   at `/claude-ops`". The site stays inactive — and its form will get
   `403 Site is inactive` — until he approves.

`references/endpoints.md` has the exact request and response bodies.

## Rules that keep this safe

- **Steps are idempotent.** Re-running a step returns what it created the
  first time. If a run is interrupted, just run the flow again from the top.
- **The key is shown once.** A repeated key step returns `"api_key": null` —
  that is not an error, it means the site already has its key. If the
  plaintext was lost, tell the owner; a new key is issued from the CRM, not
  from here.
- **The test lead is a fixture**, not a real customer, and the owner's
  approval deletes it. Do not create extra contacts to "check".
- **On `404` or `422`, stop that row.** Record what happened and move on:
  ```bash
  curl -sS -X PATCH -H "X-Ops-Token: $VCRM_OPS_TOKEN" -H "Content-Type: application/json" \
    -d '{"state":"needs_input","needs_input":"owner_email nadie@ejemplo.com no existe en el negocio"}' \
    "$VCRM_OPS_URL/api/ops/v1/batches/$BATCH/rows/$ROW"
  ```
  Then tell the owner what you need. Never guess an owner, a stage set or a
  business someone belongs to.
- **Never ask the owner for his CRM password**, and never try to work around a
  refusal. If the token cannot do something, that is the design.

## Typical run

```bash
BASE="$VCRM_OPS_URL/api/ops/v1"
AUTH=(-H "X-Ops-Token: $VCRM_OPS_TOKEN" -H "Content-Type: application/json")

BATCH=$(curl -sS "${AUTH[@]}" -d '{"title":"dentista de Luque"}' "$BASE/batches" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["batch"]["id"])')

ROW=$(curl -sS "${AUTH[@]}" -d '{"rows":[{
  "domain":"dentistaluque.com.py",
  "display_name":"Dentista Luque",
  "details":{
    "admin_email":"dra.gimenez@dentistaluque.com.py",
    "admin_name":"Dra. Giménez",
    "owner_email":"dra.gimenez@dentistaluque.com.py",
    "stages":["Nuevo","Contactado","Presupuesto","Ganado","Perdido"],
    "tags":["ortodoncia","implantes"]
  }}]}' "$BASE/batches/$BATCH/rows" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["rows"][0]["id"])')

for step in tenant site pipeline key test-lead; do
  curl -sS -X POST "${AUTH[@]}" "$BASE/rows/$ROW/$step"
done
```

The `key` step's response carries the one plaintext key:
`{"api_key_id":"…","api_key":"vc_live_…","repeated":false}`.

## After the run

Say exactly this to the owner, filling in the domain:

> El CRM de **<dominio>** está listo: empresa, sitio, pipeline, etiquetas y
> clave creados, y entró un lead de prueba. **El sitio todavía no está
> activo** — aprobalo en `/claude-ops` y se activa (y se borra el lead de
> prueba). Hasta entonces el formulario responde 403.
