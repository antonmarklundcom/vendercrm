#!/usr/bin/env node
// Bulk site provisioning through the Claude Ops API (PLAN.md §18.3).
//
// Talks HTTP only — no database, no repo build — so it runs anywhere the CRM
// is reachable:
//
//   $env:VCRM_OPS_URL   = "https://crm.clientes.com.py"
//   $env:VCRM_OPS_TOKEN = "vc_ops_..."
//   node scripts/provision-sites.mjs scripts/domains.txt --dry-run
//   node scripts/provision-sites.mjs scripts/domains.txt
//
// The domains file is one entry per line; `#` comments and blanks are
// ignored. A display name may follow the domain after a comma, otherwise it
// is derived from the first label:
//
//   dentista.com.py, Dentista Paraguay
//   gruas.com.py
//
// ---------------------------------------------------------------------------
// Rate limiting
//
// The ops API allows 120 calls per minute per token
// (`RATE_LIMIT` in src/modules/ops/http.ts). Each domain costs 5 calls — one
// per provisioning step — so the ceiling is 24 domains a minute and a fixed
// delay guessed against it will eventually cross the line: the window is
// rolling, not aligned to when the run started.
//
// So this does not guess. It paces itself just under the ceiling from the
// call count it is keeping anyway, and when the server does answer 429 it
// honours `Retry-After` and backs off exponentially rather than hammering.
// A run that is throttled slows down; it does not fail.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";

const BASE = (process.env.VCRM_OPS_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.VCRM_OPS_TOKEN ?? "";

const CALLS_PER_MINUTE = 120;
/** Leave headroom: the console and any other session share this token's budget. */
const TARGET_UTILISATION = 0.8;
const MIN_GAP_MS = Math.ceil(60_000 / (CALLS_PER_MINUTE * TARGET_UTILISATION));

const MAX_RETRIES = 6;
const STEPS = ["tenant", "site", "pipeline", "key", "test-lead"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastCallAt = 0;

/**
 * One request, paced and retried.
 *
 * Retries cover 429 (throttled — the case that broke the previous run) and
 * 5xx/network faults, which on a bulk run are usually a blip rather than a
 * verdict. A 4xx other than 429 is the server stating a reason, and repeating
 * the same call will get the same answer, so it is returned to the caller.
 */
async function call(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const gap = Date.now() - lastCallAt;
    if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
    lastCallAt = Date.now();

    let response;
    try {
      response = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          // `x-ops-token`, not an Authorization bearer: requireOpsToken in
          // src/lib/api/guards.ts reads this header and nothing else.
          "x-ops-token": TOKEN,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      const wait = Math.min(30_000, 2 ** attempt * 1000) + Math.random() * 500;
      console.log(`      network error, retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        return { status: response.status, data: await safeJson(response) };
      }
      // Retry-After is the server's own answer to "how long"; prefer it over
      // our guess, and fall back to exponential backoff with jitter.
      const header = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(header) && header > 0
        ? header * 1000 + 250
        : Math.min(60_000, 2 ** attempt * 1000) + Math.random() * 500;
      console.log(
        `      ${response.status}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(wait);
      continue;
    }

    return { status: response.status, data: await safeJson(response) };
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function displayNameFor(domain) {
  const label = domain.split(".")[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function readDomains(path) {
  const text = await readFile(path, "utf8");
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [domain, name] = line.split(",").map((part) => part.trim());
    if (!domain) continue;
    rows.push({ domain, display_name: name || displayNameFor(domain) });
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((arg) => !arg.startsWith("--")) ?? "scripts/domains.txt";

  if (!BASE || !TOKEN) {
    console.error("Set VCRM_OPS_URL and VCRM_OPS_TOKEN first.");
    process.exit(1);
  }

  const domains = await readDomains(file);
  if (domains.length === 0) {
    console.error(`No domains found in ${file}`);
    process.exit(1);
  }

  console.log(`\n${domains.length} domain(s) from ${file}`);
  console.log(`Target: ${BASE}`);
  console.log(
    `Pacing: 1 call per ${MIN_GAP_MS}ms (~${Math.floor(60_000 / MIN_GAP_MS)}/min against a ${CALLS_PER_MINUTE}/min cap)`,
  );
  const minutes = (domains.length * STEPS.length * MIN_GAP_MS) / 60_000;
  console.log(`Estimated run time: ~${Math.ceil(minutes)} min\n`);

  if (dryRun) {
    for (const row of domains) console.log(`  ${row.domain}  →  ${row.display_name}`);
    console.log("\nDry run — nothing was created.\n");
    process.exit(0);
  }

  // One batch for the whole run, so the Claude Ops console shows it as a
  // single unit of work rather than N unrelated rows.
  const title = `Bulk provisioning ${new Date().toISOString().slice(0, 10)}`;
  const created = await call("POST", "/api/ops/v1/batches", {
    title,
    raw_text: domains.map((row) => row.domain).join("\n"),
  });
  if (created.status !== 201) {
    console.error(
      "Could not create the batch:",
      created.status,
      created.data?.error?.message ?? created.data,
    );
    if (created.status === 401) {
      console.error("Check VCRM_OPS_TOKEN — the server did not recognise it.");
    }
    process.exit(1);
  }
  const batchId = created.data.batch.id;
  console.log(`Batch ${batchId}\n`);

  // `details` carries no admin_email on purpose: with OPS_SHARED_ADMIN_EMAIL
  // set on the server, each business is granted to that one account and no
  // per-tenant user is created — so no reset e-mail is sent either.
  const added = await call("POST", `/api/ops/v1/batches/${batchId}/rows`, {
    rows: domains.map((row) => ({ ...row, tenant_mode: "new" })),
  });
  if (added.status !== 201) {
    console.error("Could not add rows:", added.status, added.data);
    process.exit(1);
  }

  const results = [];

  for (const [index, row] of added.data.rows.entries()) {
    console.log(`[${index + 1}/${added.data.rows.length}] ${row.domain}`);
    const result = { domain: row.domain, row_id: row.id };
    let failed = false;

    for (const step of STEPS) {
      const response = await call("POST", `/api/ops/v1/rows/${row.id}/${step}`);
      if (response.status >= 400) {
        // The API's error shape is { error: { code, message } } — reaching
        // only for `.error` prints "[object Object]" instead of the reason.
        const reason =
          response.data?.error?.message ?? response.data?.error?.code ?? response.status;
        console.log(`      ${step}: FAILED — ${reason}`);
        result.failed_step = step;
        result.error = reason;
        failed = true;
        break;
      }

      if (step === "tenant") result.tenant_id = response.data.tenant_id;
      if (step === "site") result.site_id = response.data.site_id;
      // Plaintext exists in this response and nowhere else — the CRM stores
      // only a hash. If it is not captured here it is unrecoverable, and the
      // site needs a fresh key issued instead.
      if (step === "key") result.api_key = response.data.plaintext ?? null;
      console.log(`      ${step}: ok`);
    }

    if (!failed) console.log("      → awaiting your approval in Claude Ops");
    results.push(result);
  }

  const out = `vendercrm-provisioning-results-${new Date().toISOString().slice(0, 10)}.json`;
  await writeFile(out, JSON.stringify(results, null, 2), "utf8");

  const ok = results.filter((r) => !r.failed_step).length;
  console.log(`\nDone: ${ok}/${results.length} provisioned.`);
  console.log(`Results (with API keys) written to ${out}`);
  console.log("That file holds live keys — keep it out of every repository.");
  for (const row of results.filter((r) => r.failed_step)) {
    console.log(`  FAILED ${row.domain} at ${row.failed_step}: ${row.error}`);
  }
  console.log(
    "\nEach site is created inactive. Approve them in Claude Ops to go live.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
