import { and, eq, lt } from "drizzle-orm";
import { bookings } from "@/db/schema";
import { enqueue } from "@/lib/queue";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { createActivity } from "@/modules/crm/activities";
import { BookingError, cancelBooking, getBooking, type Booking } from "./bookings";
import { getBookingType, resolveBookingTypeSettings } from "./types";
import { notifyBooking } from "./notifications";

// Señas, manual-transfer first (plan-booking.md §1, §5.2).
//
// No payment gateway is involved and that is a decision, not a gap: in this
// market the seña arrives as a bank transfer with a photo of the comprobante
// sent over WhatsApp, and a gateway would add a fee and a signup to a flow
// that already works. So the money never touches this system — what this
// module tracks is the *promise*: the slot is held, the customer was asked,
// and a human said the transfer landed.
//
// The expiry job is the other half. Without it, an abandoned "voy a
// transferir" holds a Saturday evening chair forever, and holding slots is
// exactly what makes `pending_deposit` dangerous enough to be worth a job.

export const BOOKING_DEPOSIT_EXPIRY_JOB_TYPE = "booking.deposit_expiry";

export type DepositExpiryPayload = { tenantId: string; bookingId: string };

/**
 * Schedules the release of an unpaid hold. Called on reserve, for a booking
 * that landed as `pending_deposit`.
 */
export async function scheduleDepositExpiry(
  ctx: TenantContext,
  booking: Booking,
  now: Date = new Date(),
): Promise<void> {
  const type = await getBookingType(ctx, booking.bookingTypeId);
  const settings = resolveBookingTypeSettings(type?.settings as never);
  const runAt = new Date(now.getTime() + settings.depositExpiryMinutes * 60_000);

  await enqueue(
    BOOKING_DEPOSIT_EXPIRY_JOB_TYPE,
    { tenantId: ctx.tenantId, bookingId: booking.id } satisfies DepositExpiryPayload,
    { tenantId: ctx.tenantId, runAt },
  );
}

/**
 * A human says the comprobante is good. The hold becomes a real reservation
 * and the customer gets the confirmation they have been waiting for.
 *
 * Deliberately manual: nothing in this system can see a bank account, and a
 * booking that says "confirmada" because software guessed is worse than one
 * that says "pendiente" because nobody has looked yet.
 */
export async function confirmDeposit(
  ctx: TenantContext,
  id: string,
  now: Date = new Date(),
): Promise<Booking | null> {
  const booking = await getBooking(ctx, id);
  if (!booking) throw new BookingError("notFound");
  // Idempotent rather than an error: two staff members looking at the same
  // comprobante is the normal case, and the second click should be a no-op.
  if (booking.status === "confirmed") return booking;
  if (booking.status !== "pending_deposit") throw new BookingError("alreadyCancelled");

  await tenantDb(ctx)
    .update(bookings)
    .set({
      status: "confirmed",
      depositConfirmedAt: now,
      depositConfirmedByUserId: ctx.userId,
      updatedAt: now,
    })
    .where(eq(bookings.id, id));

  await createActivity(ctx, {
    contactId: booking.contactId,
    dealId: booking.dealId ?? undefined,
    type: "booking",
    payload: {
      bookingId: id,
      status: "confirmed",
      depositConfirmed: true,
      startsAt: booking.startsAt.toISOString(),
    },
  });

  // The confirmation the customer never got when they booked, sent now that
  // the booking is actually a promise. Straight through the chain, not the
  // event bus: `booking.created` fired hours ago.
  await notifyBooking({ tenantId: ctx.tenantId, bookingId: id, kind: "confirmation" });

  return getBooking(ctx, id);
}

/** Staff say the transfer never came, before the job would have said it. */
export async function rejectDeposit(
  ctx: TenantContext,
  id: string,
  reason = "seña no recibida",
  now: Date = new Date(),
): Promise<Booking | null> {
  const booking = await getBooking(ctx, id);
  if (!booking) throw new BookingError("notFound");
  if (booking.status !== "pending_deposit") throw new BookingError("alreadyCancelled");

  return cancelBooking(ctx, id, "staff", reason, now);
}

/**
 * Releases holds whose deposit window has passed.
 *
 * Re-reads the status rather than trusting the job: the customer may have
 * transferred and staff confirmed in the meantime, and a job that cancels a
 * paid booking because it was queued two hours ago is the one failure this
 * whole flow cannot have.
 */
export async function expireDeposit(
  payload: DepositExpiryPayload,
  now: Date = new Date(),
): Promise<"expired" | "skipped"> {
  const ctx = await buildSystemTenantContext(payload.tenantId);
  if (!ctx) return "skipped";
  if (ctx.accessStatus !== "active") return "skipped";

  const booking = await getBooking(ctx, payload.bookingId);
  if (!booking || booking.status !== "pending_deposit") return "skipped";

  await cancelBooking(ctx, booking.id, "system", "deposit_expired", now);
  return "expired";
}

/**
 * A sweep for holds whose expiry job never ran — a worker restarted mid-flight,
 * a job row pruned. Cheap, and the alternative is a slot held forever with no
 * trace of why.
 */
export async function expireStaleDeposits(
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return 0;
  if (ctx.accessStatus !== "active") return 0;

  // A generous floor: anything still pending a full day after its start was
  // never going to be paid, whatever the type's own window says.
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const stale = await tenantDb(ctx).select(
    bookings,
    and(eq(bookings.status, "pending_deposit"), lt(bookings.startsAt, cutoff)),
  );

  for (const booking of stale) {
    await cancelBooking(ctx, booking.id, "system", "deposit_expired", now);
  }
  return stale.length;
}
