import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { z } from "zod";
import { bookings, bookingTypes } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { normalizePhone } from "@/modules/crm/contacts";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { getTenant, getTenantBySlug } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { tenantDb } from "@/modules/tenancy/db";
import { getSite } from "@/modules/sites/sites";
import { siteTurnstileSecret, siteTurnstileSiteKey } from "@/modules/sites/settings";
import { isDayKey, todayIn, addDays, type DayKey } from "@/modules/calendar/zoned-time";
import {
  availableSlots,
  cancelBooking,
  reserveBooking,
  rescheduleBooking,
  BookingError,
  type Booking,
} from "./bookings";
import { resolveBookingTypeSettings, type BookingQuestion, type BookingType } from "./types";
import {
  extraDurationOf,
  listActiveServicesForType,
  resolveBookedServices,
  type BookingTypeService,
} from "./services";

// The public booking surface (docs/SPEC-BOOKING.md §5). Resolving a tenant
// slug to a tenant happens *before* any TenantContext exists — structurally
// the same platform-wide lookup the API-key and WhatsApp `phone_number_id`
// routing do, and covered by the same documented exemption (PLAN.md §3.3).
// Everything after the resolution runs through a system context and
// tenantDb, so isolation is unchanged.
//
// No CORS anywhere on this surface: every fetch is same-origin, from our own
// page. §5.1's lock is untouched.

export type PublicBookingType = {
  tenant: NonNullable<Awaited<ReturnType<typeof getTenantBySlug>>>;
  ctx: TenantContext;
  type: BookingType;
  timeZone: string;
  questions: BookingQuestion[];
  turnstileSiteKey: string | null;
  /** Add-ons the page offers as checkboxes; empty unless the type allows them. */
  services: BookingTypeService[];
};

export async function getPublicBookingType(
  tenantSlug: string,
  typeSlug: string,
): Promise<PublicBookingType | null> {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return null;

  const ctx = await buildSystemTenantContext(tenant.id);
  if (!ctx) return null;

  const [type] = await tenantDb(ctx).select(bookingTypes, eq(bookingTypes.slug, typeSlug));
  if (!type || !type.isActive) return null;

  // Only the public site key is returned here — the page renders it. The
  // secret is read separately, inside the reserve path, and never leaves the
  // server (§3.4).
  const settings = resolveBookingTypeSettings(type.settings as never);
  const turnstileSite = settings.turnstileSiteId
    ? await getSite(ctx, settings.turnstileSiteId)
    : null;

  return {
    tenant,
    ctx,
    type,
    timeZone: tenant.timezone,
    questions: (type.questions as BookingQuestion[] | null) ?? [],
    turnstileSiteKey: turnstileSite ? siteTurnstileSiteKey(turnstileSite) : null,
    services: type.allowMultiService ? await listActiveServicesForType(ctx, type.id) : [],
  };
}

/**
 * The visitor-facing shape: a start time, and — only for a type with
 * capacity — how many places are left.
 *
 * Still nothing about *who* is free: resource ids and team shape stay
 * server-side (§5.1). "Quedan 3 lugares" is about the class the visitor is
 * buying into; "Ana is free but Bruno isn't" is about the business.
 */
export type PublicSlot = { startsAt: string; seatsRemaining?: number };

const SLOTS_RATE_LIMIT = 30;
const RESERVE_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

export type PublicOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 404 | 403 | 409 | 422 | 429; error: string };

/**
 * Slots for a window. Deliberately returns starts only — never resource ids,
 * never who is free, never how many are left: the public page has no reason
 * to know the shape of someone's team.
 */
export async function publicSlots(
  tenantSlug: string,
  typeSlug: string,
  fromRaw: string | null,
  toRaw: string | null,
  ipAddress: string,
  now: Date = new Date(),
  serviceIds: string[] = [],
): Promise<PublicOutcome<PublicSlot[]>> {
  const resolved = await getPublicBookingType(tenantSlug, typeSlug);
  if (!resolved) return { ok: false, status: 404, error: "not_found" };

  if (checkRateLimit(`booking-slots:${resolved.type.id}:${ipAddress}`, SLOTS_RATE_LIMIT, RATE_WINDOW_MS).limited) {
    return { ok: false, status: 429, error: "rate_limited" };
  }

  const today = todayIn(resolved.timeZone, now);
  const from: DayKey = isDayKey(fromRaw ?? undefined) ? fromRaw! : today;
  const to: DayKey = isDayKey(toRaw ?? undefined) ? toRaw! : addDays(from, 30);

  // A window nobody asked for is a window nobody has to pay for: cap the
  // span so one request can't walk a year of the calendar.
  if (to < from || to > addDays(from, 62)) {
    return { ok: false, status: 422, error: "invalid_range" };
  }

  // The visitor's ticked add-ons lengthen the appointment, so they change
  // which starts still fit before closing time — the picker re-fetches when
  // they tick one.
  const chosen = await resolveBookedServices(resolved.ctx, resolved.type.id, serviceIds);
  const slots = await availableSlots(
    resolved.ctx,
    resolved.type,
    from,
    to,
    now,
    undefined,
    extraDurationOf(chosen),
  );

  const hasCapacity = resolved.type.capacity > 1;
  return {
    ok: true,
    data: slots.map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
      ...(hasCapacity ? { seatsRemaining: slot.seatsRemaining } : {}),
    })),
  };
}

export const publicReserveSchema = z.object({
  startsAt: z.string().min(10),
  name: z.string().min(1).max(200),
  phone: z.string().min(6).max(30),
  email: z.string().email().max(320).optional().or(z.literal("")),
  message: z.string().max(5000).optional(),
  answers: z.record(z.string(), z.string().max(2000)).optional(),
  /** Places wanted, for a type with capacity > 1. */
  party_size: z.coerce.number().int().min(1).max(100).optional(),
  /** Ids of the ticked add-ons; validated against the type server-side. */
  service_ids: z.array(z.string().max(26)).max(20).optional(),
  turnstile_token: z.string().max(4000).optional(),
  utm: z
    .object({
      source: z.string().max(200).optional(),
      medium: z.string().max(200).optional(),
      campaign: z.string().max(200).optional(),
      term: z.string().max(200).optional(),
      content: z.string().max(200).optional(),
      gclid: z.string().max(200).optional(),
      fbclid: z.string().max(200).optional(),
    })
    .optional(),
  page_url: z.string().max(2000).optional(),
  referrer: z.string().max(2000).optional(),
  /** Honeypot — a real visitor never fills it. */
  _hp: z.string().max(200).optional(),
});

export type PublicReserveResult = {
  bookingId: string;
  startsAt: string;
  manageToken: string;
  /** `pending_deposit` — the page has to ask for the seña, not say "listo". */
  status: Booking["status"];
};

export async function publicReserve(
  tenantSlug: string,
  typeSlug: string,
  rawBody: unknown,
  // `ipAddress` is what gets *recorded* (undefined when unknown, because
  // "unknown" is not an address); `ipKey` is what the limiter buckets on,
  // where an undeterminable address must land in one shared bucket rather
  // than becoming a free pass. See lib/http/client-ip.
  meta: { ipAddress?: string; ipKey?: string; userAgent?: string } = {},
  now: Date = new Date(),
): Promise<PublicOutcome<PublicReserveResult>> {
  const resolved = await getPublicBookingType(tenantSlug, typeSlug);
  if (!resolved) return { ok: false, status: 404, error: "not_found" };

  const ip = meta.ipKey ?? meta.ipAddress ?? "unknown";
  if (checkRateLimit(`booking-reserve:${resolved.type.id}:${ip}`, RESERVE_RATE_LIMIT, RATE_WINDOW_MS).limited) {
    return { ok: false, status: 429, error: "rate_limited" };
  }

  const parsed = publicReserveSchema.safeParse(rawBody);
  if (!parsed.success) return { ok: false, status: 422, error: "invalid_body" };
  const body = parsed.data;

  // The honeypot answers 200-shaped success to a bot rather than teaching it
  // what tripped — but nothing is written.
  if (body._hp) return { ok: false, status: 422, error: "invalid_body" };

  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return { ok: false, status: 422, error: "invalid_body" };
  }

  const settings = resolveBookingTypeSettings(resolved.type.settings as never);
  // Three states, the same ladder §5.2.1 established: no secret configured →
  // skipped entirely; configured with a token → verified; configured with no
  // token → accepted unless the type requires it.
  const turnstileSite = settings.turnstileSiteId
    ? await getSite(resolved.ctx, settings.turnstileSiteId)
    : null;
  const secret = turnstileSite ? siteTurnstileSecret(turnstileSite) : null;
  if (secret && (body.turnstile_token || settings.requireTurnstile)) {
    const verdict = await verifyTurnstileToken({
      secret,
      token: body.turnstile_token,
      remoteIp: meta.ipAddress,
    });
    if (!verdict.ok) return { ok: false, status: 403, error: "turnstile_failed" };
  }

  const tenantSettings = (resolved.tenant.settings ?? {}) as TenantSettings;

  try {
    const result = await reserveBooking(
      resolved.ctx,
      {
        bookingTypeId: resolved.type.id,
        startsAt,
        name: body.name,
        phone: normalizePhone(body.phone, tenantSettings.defaultCountry ?? DEFAULT_COUNTRY),
        email: body.email || undefined,
        message: body.message,
        answers: body.answers,
        partySize: body.party_size,
        serviceIds: body.service_ids,
        utm: body.utm,
        pageUrl: body.page_url,
        referrer: body.referrer,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        source: `booking:${resolved.type.slug}`,
      },
      now,
    );

    return {
      ok: true,
      data: {
        bookingId: result.booking.id,
        startsAt: result.booking.startsAt.toISOString(),
        manageToken: result.booking.publicToken,
        status: result.booking.status,
      },
    };
  } catch (error) {
    return { ok: false, ...publicErrorFor(error) };
  }
}

function publicErrorFor(error: unknown): { status: 404 | 403 | 409 | 422; error: string } {
  if (error instanceof BookingError) {
    switch (error.code) {
      case "slotTaken":
      case "slotUnavailable":
        // "Someone beat you to it" is a real outcome the visitor must see,
        // and it is neither their fault nor a validation error.
        return { status: 409, error: "slot_taken" };
      case "cutoffPassed":
        return { status: 403, error: "cutoff_passed" };
      case "inactive":
      case "notFound":
        return { status: 404, error: "not_found" };
      case "alreadyCancelled":
        return { status: 409, error: "already_cancelled" };
      case "sameSlot":
        // Not a failure the visitor caused, and not one worth a scary
        // message: they picked the time they already have.
        return { status: 422, error: "same_slot" };
      case "partyTooLarge":
        // Not "someone beat you to it": no amount of waiting makes a party
        // of eight fit a class of six.
        return { status: 422, error: "party_too_large" };
    }
  }
  return { status: 422, error: "invalid_body" };
}

export type PublicBooking = {
  ctx: TenantContext;
  booking: Booking;
  type: BookingType;
  tenant: NonNullable<Awaited<ReturnType<typeof getTenantBySlug>>>;
  canCancel: boolean;
};

/**
 * Resolve a manage link. The token is the secret, exactly as `/q/[token]`
 * (§8) — which is why an unknown one is a 404 and never a hint about which
 * half was wrong.
 */
export async function getPublicBooking(
  token: string,
  now: Date = new Date(),
): Promise<PublicBooking | null> {
  const [row] = await db.select().from(bookings).where(eq(bookings.publicToken, token)).limit(1);
  if (!row) return null;

  const ctx = await buildSystemTenantContext(row.tenantId);
  if (!ctx) return null;

  const [type] = await tenantDb(ctx).select(bookingTypes, eq(bookingTypes.id, row.bookingTypeId));
  if (!type) return null;

  const tenant = await getTenant(row.tenantId);
  if (!tenant) return null;

  const settings = resolveBookingTypeSettings(type.settings as never);
  const cutoff = row.startsAt.getTime() - settings.cancellationCutoffMinutes * 60_000;

  return {
    ctx,
    booking: row,
    type,
    tenant,
    canCancel: row.status === "confirmed" && now.getTime() <= cutoff,
  };
}

export async function publicCancel(
  token: string,
  reason: string | undefined,
  ipAddress: string,
  now: Date = new Date(),
): Promise<PublicOutcome<{ bookingId: string }>> {
  if (checkRateLimit(`booking-manage:${token}`, RESERVE_RATE_LIMIT, RATE_WINDOW_MS).limited) {
    return { ok: false, status: 429, error: "rate_limited" };
  }
  void ipAddress;

  const resolved = await getPublicBooking(token, now);
  if (!resolved) return { ok: false, status: 404, error: "not_found" };

  try {
    await cancelBooking(resolved.ctx, resolved.booking.id, "contact", reason, now);
    return { ok: true, data: { bookingId: resolved.booking.id } };
  } catch (error) {
    return { ok: false, ...publicErrorFor(error) };
  }
}

export async function publicReschedule(
  token: string,
  startsAtRaw: string,
  ipAddress: string,
  now: Date = new Date(),
): Promise<PublicOutcome<PublicReserveResult>> {
  if (checkRateLimit(`booking-manage:${token}`, RESERVE_RATE_LIMIT, RATE_WINDOW_MS).limited) {
    return { ok: false, status: 429, error: "rate_limited" };
  }
  void ipAddress;

  const resolved = await getPublicBooking(token, now);
  if (!resolved) return { ok: false, status: 404, error: "not_found" };

  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) {
    return { ok: false, status: 422, error: "invalid_body" };
  }

  try {
    const result = await rescheduleBooking(
      resolved.ctx,
      resolved.booking.id,
      startsAt,
      "contact",
      now,
    );
    return {
      ok: true,
      data: {
        bookingId: result.booking.id,
        startsAt: result.booking.startsAt.toISOString(),
        manageToken: result.booking.publicToken,
        status: result.booking.status,
      },
    };
  } catch (error) {
    return { ok: false, ...publicErrorFor(error) };
  }
}
