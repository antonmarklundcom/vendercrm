import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireOpsToken, requireWithinRateLimit } from "@/lib/api/guards";
import { clientIpOrNull } from "@/lib/http/client-ip";
import { rowDetails, rowSteps, type OpsBatchRow, type OpsRow } from "./batches";
import { OpsAccessError } from "./guard";
import type { OpsTokenRow } from "./tokens";

// The transport half of `/api/ops/v1` (PLAN.md §18.1.8): authentication, the
// per-token rate limit, one error shape and one row shape. It lives in the
// module rather than under `src/app/api` so the ten route files stay what a
// route file should be — a few lines naming the step they call.

/** Generous enough for a session provisioning a dozen sites in one run, low
 * enough that a token loose on the internet gets nowhere fast. */
const RATE_LIMIT = { limit: 120, windowMs: 60_000 };

/** A caller with no valid token gets nothing but a hash lookup, and this
 * caps how many of those one address may spend. The token itself is 32
 * random bytes, so this is about the database rather than about guessing. */
const ANONYMOUS_RATE_LIMIT = { limit: 300, windowMs: 60_000 };

export type OpsAuth = { ok: true; token: OpsTokenRow } | { ok: false; response: Response };

export async function authenticateOpsRequest(request: Request): Promise<OpsAuth> {
  const ip = clientIpOrNull(request.headers);
  if (ip) {
    const perIp = await requireWithinRateLimit(
      `ops:ip:${ip}`,
      ANONYMOUS_RATE_LIMIT.limit,
      ANONYMOUS_RATE_LIMIT.windowMs,
    );
    if (!perIp.ok) return perIp;
  }

  const guard = await requireOpsToken(request);
  if (!guard.ok) return guard;

  const limited = await requireWithinRateLimit(
    `ops:${guard.token.id}`,
    RATE_LIMIT.limit,
    RATE_LIMIT.windowMs,
  );
  if (!limited.ok) return limited;

  return { ok: true, token: guard.token };
}

/**
 * Turns a refusal into the uniform body. Anything that is not an
 * `OpsAccessError` is a bug rather than a stated refusal, so it is re-thrown
 * and becomes an ordinary 500 — the row still carries the failure verbatim,
 * because `provision.ts` records it before the error leaves the step.
 */
export function opsErrorResponse(err: unknown): Response {
  if (err instanceof OpsAccessError) {
    if (err.status === 404) return apiError("not_found", 404, err.reason);
    if (err.status === 409) return apiError("conflict", 409, err.reason);
    return apiError("invalid_request", 422, err.reason);
  }
  throw err;
}

/** Parses a JSON body against a schema, answering 422 with the field paths. */
export async function readJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError("invalid_request", 422, "invalid JSON body") };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return { ok: false, response: apiError("invalid_request", 422, reason) };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Same, for a body that may legitimately be absent — the key step's only
 * field is an optional label, and `POST` with no body at all is the common
 * case from a shell.
 */
export async function readOptionalJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> | null } | { ok: false; response: Response }> {
  const raw = (await request.text()).trim();
  if (!raw) return { ok: true, data: null };

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(raw);
  } catch {
    return { ok: false, response: apiError("invalid_request", 422, "invalid JSON body") };
  }

  const parsed = schema.safeParse(parsedRaw);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return { ok: false, response: apiError("invalid_request", 422, reason) };
  }

  return { ok: true, data: parsed.data };
}

export function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status });
}

/**
 * What a session may put in `details` — the pipeline and tenant steps' whole
 * input. `strict()` on purpose: a typo like `owner_mail` should be a 422 the
 * session can read, not a silently ignored field that surfaces three steps
 * later as "no default owner".
 */
export const opsRowDetailsSchema = z
  .object({
    stages: z.array(z.string().min(1).max(100)).max(20).optional(),
    owner_email: z.string().email().max(320).optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    wa_account_id: z.string().max(26).optional(),
    notes: z.string().max(2000).optional(),
    admin_email: z.string().email().max(320).optional(),
    admin_name: z.string().max(200).optional(),
    tenant_name: z.string().max(200).optional(),
    tenant_slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, "tenant_slug must be lowercase letters, digits and dashes")
      .optional(),
  })
  .strict();

// --- Serialization ------------------------------------------------------
//
// snake_case on the wire, because the consumer is a skill's `curl` examples
// and a session reading JSON, not this codebase.

export function serializeBatch(batch: OpsBatchRow) {
  return {
    id: batch.id,
    title: batch.title,
    status: batch.status,
    raw_text: batch.rawText,
    created_at: batch.createdAt,
    updated_at: batch.updatedAt,
  };
}

export function serializeRow(row: OpsRow) {
  return {
    id: row.id,
    batch_id: row.batchId,
    domain: row.domain,
    display_name: row.displayName,
    tenant_mode: row.tenantMode,
    tenant_id: row.tenantId,
    details: rowDetails(row),
    state: row.state,
    steps: rowSteps(row),
    last_error: row.lastError ?? null,
    needs_input: row.needsInput,
    site_id: row.siteId,
    pipeline_id: row.pipelineId,
    api_key_id: row.apiKeyId,
    test_contact_id: row.testContactId,
    test_deal_id: row.testDealId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
