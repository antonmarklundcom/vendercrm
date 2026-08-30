import { eq } from "drizzle-orm";
import { conversations } from "@/db/schema";
import { formatDateTime } from "@/lib/i18n/format";
import { type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getContact } from "@/modules/crm/contacts";
import { getTenant } from "@/modules/tenancy/tenants";
import { sendInteractive, sendText } from "@/modules/whatsapp/send";
import { todayIn, addDays } from "@/modules/calendar/zoned-time";
import { availableSlots, reserveBooking, BookingError } from "./bookings";
import { getBookingType } from "./types";
import { decodeSlotChoice, encodeSlotChoice } from "./slot-choice";

// Booking from inside the conversation (plan-booking.md §5.3).
//
// The reason this exists at all: in this market the customer is already in
// WhatsApp. Sending them a link to a web page to pick a time they could have
// tapped in the chat loses people at every hop. So a rep (or an automation,
// or the AI) offers the next free slots as tappable options, and the tap
// *is* the reservation.
//
// What it deliberately does NOT do is reserve through a second code path.
// The tap lands in `reserveBooking` — the same transaction, the same three
// double-booking guards, the same capacity accounting as the public page. A
// parallel "quick reserve" would be exactly the place a double-booking bug
// would eventually live.

export type OfferOutcome =
  | { status: "offered"; count: number }
  | { status: "skipped"; reason: "no_slots" | "not_found" | "window_closed" };

/**
 * Offers the next free slots for a booking type in an open conversation.
 *
 * Free-form, so it needs an open 24h window — which is the right constraint
 * rather than a limitation: this is an answer to somebody who just asked
 * "¿tenés lugar el jueves?", not a way to cold-message a list.
 */
export async function offerSlots(
  ctx: TenantContext,
  input: { conversationId: string; bookingTypeId: string; limit?: number },
  now: Date = new Date(),
): Promise<OfferOutcome> {
  const [type, tenant] = await Promise.all([
    getBookingType(ctx, input.bookingTypeId),
    getTenant(ctx.tenantId),
  ]);
  if (!type || !type.isActive || !tenant) return { status: "skipped", reason: "not_found" };

  const from = todayIn(tenant.timezone, now);
  const slots = await availableSlots(ctx, type, from, addDays(from, 14), now);
  // Meta caps a list at ten rows; offering fewer is also just kinder — a
  // wall of times is harder to answer than four.
  const offered = slots.slice(0, Math.min(input.limit ?? 5, 10));
  if (offered.length === 0) return { status: "skipped", reason: "no_slots" };

  try {
    await sendInteractive(ctx, {
      conversationId: input.conversationId,
      header: type.name,
      body: `Estos son los próximos horarios para ${type.name}. Tocá el que te sirva y queda reservado.`,
      actionLabel: "Ver horarios",
      rows: offered.map((slot) => ({
        id: encodeSlotChoice(type.id, slot.startsAt),
        title: formatDateTime(slot.startsAt, tenant.locale, tenant.timezone),
        ...(type.capacity > 1 ? { description: `Quedan ${slot.seatsRemaining}` } : {}),
      })),
    });
  } catch {
    // The window shut between the rep pressing the button and the send. Not
    // an error worth a stack trace at the caller: the rep needs to know they
    // must wait for the customer to write.
    return { status: "skipped", reason: "window_closed" };
  }

  return { status: "offered", count: offered.length };
}

export type TapOutcome =
  | { status: "booked"; bookingId: string }
  | { status: "ignored" }
  | { status: "failed"; reason: "taken" | "gone" | "error" };

/**
 * Turns a tapped slot into a booking, then tells the customer in the same
 * thread what happened.
 *
 * The contact already exists — they are messaging us — so the name and phone
 * come off the contact record rather than being asked for again. That is the
 * whole point of booking in the conversation.
 */
export async function handleSlotTap(
  ctx: TenantContext,
  input: { conversationId: string; contactId: string; replyId: string },
  now: Date = new Date(),
): Promise<TapOutcome> {
  const choice = decodeSlotChoice(input.replyId);
  if (!choice) return { status: "ignored" };

  const [contact, tenant] = await Promise.all([
    getContact(ctx, input.contactId),
    getTenant(ctx.tenantId),
  ]);
  if (!contact || !tenant) return { status: "failed", reason: "error" };

  try {
    const result = await reserveBooking(
      ctx,
      {
        bookingTypeId: choice.bookingTypeId,
        startsAt: choice.startsAt,
        name: contact.name,
        phone: contact.phone,
        email: contact.email ?? undefined,
        source: "whatsapp",
      },
      now,
    );

    // The confirmation itself comes from the B1 chain on `booking.created`
    // — including the seña request when the type asks for one — so nothing
    // is sent here. Sending a second "listo" would contradict a
    // `pending_deposit` booking in the same thread.
    return { status: "booked", bookingId: result.booking.id };
  } catch (error) {
    if (error instanceof BookingError) {
      const taken = error.code === "slotTaken" || error.code === "slotUnavailable";
      // Somebody took it while the list sat unread — the one outcome the
      // customer must hear about, in the thread they tapped in.
      await sayQuietly(
        ctx,
        input.conversationId,
        taken
          ? "Uf, justo se ocupó ese horario. Te paso otros ahora mismo."
          : "No pudimos tomar esa reserva. Escribinos y lo vemos.",
      );
      if (taken) {
        await offerSlots(ctx, {
          conversationId: input.conversationId,
          bookingTypeId: choice.bookingTypeId,
        }, now);
      }
      return { status: "failed", reason: taken ? "taken" : "gone" };
    }
    return { status: "failed", reason: "error" };
  }
}

/**
 * A best-effort reply. The customer just messaged us so the window is open
 * by construction — but a send that fails must not turn a successful (or
 * legitimately failed) booking into an exception in the webhook job.
 */
async function sayQuietly(ctx: TenantContext, conversationId: string, body: string) {
  try {
    await sendText(ctx, { conversationId, body });
  } catch {
    /* the booking's own outcome is what matters */
  }
}

/** The conversation a webhook reply belongs to, scoped to the tenant. */
export async function conversationContact(
  ctx: TenantContext,
  conversationId: string,
): Promise<string | null> {
  const [row] = await tenantDb(ctx).select(conversations, eq(conversations.id, conversationId));
  return row?.contactId ?? null;
}
