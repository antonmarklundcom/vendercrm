import { and, eq } from "drizzle-orm";
import { gcalConnections } from "@/db/schema";
import { env } from "@/lib/config/env";
import { decrypt, encrypt } from "@/lib/crypto";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Google Calendar, **busy-read only** (plan-booking.md §5.4, §1).
//
// The scope is the decision worth defending. Two-way sync is what everyone
// asks for and is a support burden out of proportion to its value here: it
// means conflict resolution, deletion semantics, and a class of bug where
// the CRM quietly rewrites somebody's personal calendar. Reading busy
// windows solves the actual complaint — "the system booked me while I was at
// the dentist" — with an API that cannot damage anything.
//
// So this module asks Google one question: when is this person busy? The
// answer is merged into the busy list `modules/booking/bookings.ts` already
// builds, *outside* `slots.ts`, which stays pure.

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

/** Read-only, and the narrowest scope that answers the freebusy question. */
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export type GcalConnection = typeof gcalConnections.$inferSelect;

/** False when the platform has no Google credentials — the feature no-ops. */
export function isGcalConfigured(): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
}

export function gcalRedirectUri(): string {
  return `${env.APP_URL}/api/gcal/callback`;
}

/**
 * The consent URL for one staff member.
 *
 * `state` carries the tenant and user so the callback knows whose calendar
 * came back without trusting anything Google echoes about identity. It is
 * signed nowhere and read only as a lookup key — the callback re-derives the
 * session's own tenant and refuses a mismatch.
 */
export function gcalAuthUrl(state: string): string | null {
  if (!isGcalConfigured()) return null;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: gcalRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    // Without both of these Google returns no refresh token on a repeat
    // authorization, and the connection dies silently an hour later.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${OAUTH_AUTH_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(json.error_description || json.error || `Google token error ${res.status}`);
  }
  return json;
}

/** Exchanges the callback code and stores the connection for one user. */
export async function connectGcal(
  ctx: TenantContext,
  userId: string,
  code: string,
): Promise<GcalConnection | null> {
  if (!isGcalConfigured()) throw new Error("Google Calendar no está configurado.");

  const token = await requestToken({
    code,
    redirect_uri: gcalRedirectUri(),
    grant_type: "authorization_code",
  });

  const access = encrypt(token.access_token);
  const refresh = token.refresh_token ? encrypt(token.refresh_token) : null;
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;

  const existing = await getConnection(ctx, userId);
  const values = {
    accessTokenCiphertext: access.ciphertext,
    accessTokenIv: access.iv,
    accessTokenTag: access.tag,
    accessTokenExpiresAt: expiresAt,
    // A re-authorization that returns no refresh token must not wipe the one
    // already stored, or reconnecting would break the connection it fixed.
    ...(refresh
      ? {
          refreshTokenCiphertext: refresh.ciphertext,
          refreshTokenIv: refresh.iv,
          refreshTokenTag: refresh.tag,
        }
      : {}),
    status: "connected" as const,
    lastError: null,
    updatedAt: new Date(),
  };

  if (existing) {
    await tenantDb(ctx)
      .update(gcalConnections)
      .set(values)
      .where(eq(gcalConnections.id, existing.id));
    return getConnection(ctx, userId);
  }

  await tenantDb(ctx)
    .insert(gcalConnections)
    .values({ id: newId(), userId, calendarId: "primary", ...values });
  return getConnection(ctx, userId);
}

export async function getConnection(
  ctx: TenantContext,
  userId: string,
): Promise<GcalConnection | null> {
  const [row] = await tenantDb(ctx).select(
    gcalConnections,
    eq(gcalConnections.userId, userId),
  );
  return row ?? null;
}

export async function listConnections(ctx: TenantContext): Promise<GcalConnection[]> {
  return tenantDb(ctx).select(gcalConnections);
}

/**
 * Forgets the connection. The Google-side grant is not revoked from here:
 * doing so needs a live token we may no longer have, and leaving a stale
 * grant in someone's Google account is a smaller problem than a disconnect
 * button that fails when the token has already expired.
 */
export async function disconnectGcal(ctx: TenantContext, userId: string): Promise<void> {
  await tenantDb(ctx).delete(
    gcalConnections,
    and(eq(gcalConnections.userId, userId), eq(gcalConnections.tenantId, ctx.tenantId)),
  );
}

async function markConnectionError(
  ctx: TenantContext,
  connection: GcalConnection,
  message: string,
): Promise<void> {
  await tenantDb(ctx)
    .update(gcalConnections)
    .set({
      // `revoked` and `error` are different fixes for the operator: one needs
      // the user to reconnect, the other may clear on its own.
      status: /invalid_grant|unauthorized/i.test(message) ? "revoked" : "error",
      lastError: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(gcalConnections.id, connection.id));
}

/** A usable access token, refreshed if the stored one is spent. */
async function accessTokenFor(
  ctx: TenantContext,
  connection: GcalConnection,
): Promise<string | null> {
  const fresh =
    connection.accessTokenExpiresAt &&
    // A minute of slack: a token that expires mid-request is a failure that
    // looks like an outage.
    connection.accessTokenExpiresAt.getTime() - 60_000 > Date.now();

  if (fresh) {
    return decrypt({
      ciphertext: connection.accessTokenCiphertext,
      iv: connection.accessTokenIv,
      tag: connection.accessTokenTag,
    });
  }

  if (!connection.refreshTokenCiphertext) {
    await markConnectionError(ctx, connection, "Sin refresh token — reconectá el calendario.");
    return null;
  }

  const refreshToken = decrypt({
    ciphertext: connection.refreshTokenCiphertext,
    iv: connection.refreshTokenIv!,
    tag: connection.refreshTokenTag!,
  });

  try {
    const token = await requestToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
    const access = encrypt(token.access_token);
    await tenantDb(ctx)
      .update(gcalConnections)
      .set({
        accessTokenCiphertext: access.ciphertext,
        accessTokenIv: access.iv,
        accessTokenTag: access.tag,
        accessTokenExpiresAt: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000)
          : null,
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(gcalConnections.id, connection.id));
    return token.access_token;
  } catch (err) {
    await markConnectionError(ctx, connection, err instanceof Error ? err.message : String(err));
    return null;
  }
}

export type GcalBusy = { userId: string; startsAt: Date; endsAt: Date };

/**
 * Busy windows for a set of staff users, from whichever of them have a
 * working connection.
 *
 * Never throws. This runs inside slot generation, and a Google outage must
 * degrade to "no Google busy windows" — offering a slot that turns out to
 * clash with a private appointment — rather than taking the whole booking
 * page down. That trade is deliberate and is the reason the busy list is a
 * union rather than a source of truth.
 */
export async function busyFromGoogle(
  ctx: TenantContext,
  userIds: string[],
  from: Date,
  to: Date,
): Promise<GcalBusy[]> {
  if (!isGcalConfigured() || userIds.length === 0) return [];

  const connections = (await listConnections(ctx)).filter(
    (row) => userIds.includes(row.userId) && row.status !== "revoked",
  );
  if (connections.length === 0) return [];

  const results = await Promise.all(
    connections.map(async (connection) => {
      try {
        return await freeBusyFor(ctx, connection, from, to);
      } catch (err) {
        await markConnectionError(
          ctx,
          connection,
          err instanceof Error ? err.message : String(err),
        ).catch(() => undefined);
        return [];
      }
    }),
  );

  return results.flat();
}

async function freeBusyFor(
  ctx: TenantContext,
  connection: GcalConnection,
  from: Date,
  to: Date,
): Promise<GcalBusy[]> {
  const token = await accessTokenFor(ctx, connection);
  if (!token) return [];

  const res = await fetch(FREEBUSY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: connection.calendarId }],
    }),
  });

  if (!res.ok) throw new Error(`freeBusy ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>;
  };
  const calendar = body.calendars?.[connection.calendarId];
  if (calendar?.errors?.length) {
    throw new Error(`freeBusy calendar error: ${JSON.stringify(calendar.errors).slice(0, 200)}`);
  }

  await tenantDb(ctx)
    .update(gcalConnections)
    .set({ lastBusyReadAt: new Date(), status: "connected", lastError: null })
    .where(eq(gcalConnections.id, connection.id));

  return (calendar?.busy ?? []).map((window) => ({
    userId: connection.userId,
    startsAt: new Date(window.start),
    endsAt: new Date(window.end),
  }));
}
