import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/config/cron-secret";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTenantContext, type TenantContext } from "@/modules/tenancy/context";

// One place for "who is allowed to call this route" (PLAN.md §13 H9 #2).
// Before this the eleven API routes carried five different inline patterns
// and three different JSON error shapes — `{error:"Unauthorized"}`,
// `{error:"unauthorized"}`, and a bare text body — which meant a caller
// couldn't parse a failure without knowing which route it came from.
//
// Every guard returns either the thing the route needs, or a Response to
// return as-is. That shape (rather than throwing) keeps the refusal visible
// in the route body, where a reader can see the status it produces.

export type GuardFailure = { ok: false; response: Response };
export type GuardSuccess<T> = { ok: true } & T;
export type GuardResult<T> = GuardSuccess<T> | GuardFailure;

/** The uniform error body. `code` is stable and machine-readable; the
 * message is for whoever is reading a log. */
export function apiError(
  code: "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "invalid_request",
  status: number,
  message?: string,
): Response {
  return NextResponse.json({ error: { code, message: message ?? code } }, { status });
}

const unauthorized = () => apiError("unauthorized", 401);

/**
 * Hostinger-pinged cron routes and the deploy health check. Constant-time
 * comparison lives in lib/config/cron-secret; this is the response half.
 */
export function requireCronSecret(request: Request): GuardResult<Record<string, never>> {
  if (!isValidCronSecret(request.headers.get("x-cron-secret"))) {
    return { ok: false, response: unauthorized() };
  }
  return { ok: true } as GuardSuccess<Record<string, never>>;
}

/** Session-backed routes: the tenant comes from the session, never from the
 * request, so there is no tenant id for a caller to tamper with. */
export async function requireSession(): Promise<GuardResult<{ ctx: TenantContext }>> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, response: unauthorized() };
  return { ok: true, ctx };
}

/**
 * Fixed-window limiter with the shared error body. Separate from the
 * identity guards because it composes with all of them — a route can be
 * session-guarded *and* limited (the ⌘K search endpoint is both).
 */
export async function requireWithinRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<GuardResult<Record<string, never>>> {
  if ((await checkRateLimit(key, limit, windowMs)).limited) {
    return { ok: false, response: apiError("rate_limited", 429) };
  }
  return { ok: true } as GuardSuccess<Record<string, never>>;
}

/**
 * Unguessable-token routes (the contacts feed, the public document links).
 * The token *is* the credential, so a bad one answers 404 rather than 401:
 * "this link is not valid" is all the caller is entitled to learn, and a
 * 401 would confirm that valid tokens of that shape exist.
 */
export async function requireToken<T>(
  token: string | null,
  resolve: (token: string) => Promise<T | null>,
): Promise<GuardResult<{ resolved: T }>> {
  if (!token) return { ok: false, response: apiError("not_found", 404) };

  const resolved = await resolve(token);
  if (!resolved) return { ok: false, response: apiError("not_found", 404) };

  return { ok: true, resolved };
}
