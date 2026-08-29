import { randomBytes } from "node:crypto";
import { and, eq, gt, lt, ne, inArray } from "drizzle-orm";
import { bookingResources, bookings, calendarEvents, leadSubmissions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueue } from "@/lib/queue";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb, tenantTransaction } from "@/modules/tenancy/db";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { createActivity } from "@/modules/crm/activities";
import { getContact } from "@/modules/crm/contacts";
import {
  finalizeLeadSubmission,
  recordLeadSubmission,
  type LeadUtm,
} from "@/modules/leads/submissions";
import { dayKeyOf, addDays, type DayKey } from "@/modules/calendar/zoned-time";
import {
  listAvailabilityRulesForResources,
  listBlackouts,
  getResource,
  listResourcesForType,
  type BookingResource,
} from "./resources";
import { generateSlots, pickResource, type BusyInterval, type Slot } from "./slots";
import {
  getBookingType,
  resolveBookingTypeSettings,
  slotConfigOf,
  type BookingType,
} from "./types";
import { bookingEvents } from "./events";

// Reserving, cancelling, rescheduling (docs/SPEC-BOOKING.md §1, §3).
//
// One public booking writes a contact (through the same engine lead ingest
// uses), a calendar_events row so the agenda sees it with no sync job, and a
// bookings row carrying the lifecycle the calendar has no business knowing
// about.

export type Booking = typeof bookings.$inferSelect;

export const BOOKING_REMINDER_JOB_TYPE = "booking.reminder";

export class BookingError extends Error {
  constructor(
    readonly code:
      | "notFound"
      | "inactive"
      | "slotTaken"
      | "slotUnavailable"
      | "cutoffPassed"
      | "alreadyCancelled"
      /** A reschedule to the start the booking already has: nothing to do. */
      | "sameSlot",
  ) {
    super(`booking_${code}`);
  }
}

export type ReserveInput = {
  bookingTypeId: string;
  startsAt: Date;
  name: string;
  phone: string;
  email?: string;
  message?: string;
  answers?: Record<string, unknown>;
  utm?: LeadUtm;
  pageUrl?: string;
  referrer?: string;
  ipAddress?: string;
  userAgent?: string;
  source?: string;
};

export type ReserveResult = {
  booking: Booking;
  contactId: string;
  dealId: string | null;
};

function slotKey(resourceId: string, startsAt: Date): string {
  return `${resourceId}:${Math.floor(startsAt.getTime() / 1000)}`;
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * One booking that must not count as busy, and the agenda row it owns.
 *
 * Only a reschedule uses this: the booking being moved would otherwise block
 * its own replacement, and the visitor nudging 09:00 to 09:15 would be told
 * their own appointment is in the way.
 */
export type BusyExclusion = { bookingId: string; calendarEventId: string | null };

/**
 * Busy time for a set of resources.
 *
 * Two sources, unioned: the resource's own confirmed bookings, and — for a
 * resource that *is* a rep — every `calendar_events` row on their agenda,
 * booking-produced or not. The second half is the point of writing bookings
 * to the calendar at all: a rep's own 15:00 site visit has to make 15:00
 * unbookable, with no sync job in either direction.
 */
export async function busyFor(
  ctx: TenantContext,
  resources: BookingResource[],
  from: Date,
  to: Date,
  exclude?: BusyExclusion,
): Promise<BusyInterval[]> {
  if (resources.length === 0) return [];

  const bookingRows = await tenantDb(ctx).select(
    bookings,
    and(
      inArray(
        bookings.resourceId,
        resources.map((resource) => resource.id),
      ),
      eq(bookings.status, "confirmed"),
      lt(bookings.startsAt, to),
      gt(bookings.endsAt, from),
      ...(exclude ? [ne(bookings.id, exclude.bookingId)] : []),
    ),
  );

  const intervals: BusyInterval[] = bookingRows.map((row) => ({
    resourceId: row.resourceId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  }));

  const userResources = resources.filter((resource) => resource.kind === "user" && resource.userId);
  if (userResources.length > 0) {
    const events = await tenantDb(ctx).select(
      calendarEvents,
      and(
        inArray(
          calendarEvents.assignedUserId,
          userResources.map((resource) => resource.userId!),
        ),
        lt(calendarEvents.startsAt, to),
        gt(calendarEvents.endsAt, from),
        ...(exclude?.calendarEventId
          ? [ne(calendarEvents.id, exclude.calendarEventId)]
          : []),
      ),
    );
    for (const event of events) {
      const resource = userResources.find((candidate) => candidate.userId === event.assignedUserId);
      if (!resource) continue;
      intervals.push({
        resourceId: resource.id,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      });
    }
  }

  return intervals;
}

/** Everything the pure generator needs, gathered for one type and window. */
export async function availableSlots(
  ctx: TenantContext,
  type: BookingType,
  from: DayKey,
  to: DayKey,
  now: Date = new Date(),
  exclude?: BusyExclusion,
): Promise<Slot[]> {
  const tenant = await getTenant(ctx.tenantId);
  if (!tenant) return [];
  const timeZone = tenant.timezone;
  const settings = (tenant.settings ?? {}) as TenantSettings;

  const resources = await listResourcesForType(ctx, type.id);
  if (resources.length === 0) return [];

  const rules = await listAvailabilityRulesForResources(
    ctx,
    resources.map((resource) => resource.id),
  );

  // Widen the busy/blackout window by a day on each side so an event that
  // merely overlaps the edge still blocks the edge slot.
  const windowFrom = new Date(`${addDays(from, -1)}T00:00:00Z`);
  const windowTo = new Date(`${addDays(to, 2)}T00:00:00Z`);

  const [busy, blackouts] = await Promise.all([
    busyFor(ctx, resources, windowFrom, windowTo, exclude),
    listBlackouts(ctx, windowFrom, windowTo),
  ]);

  return generateSlots({
    timeZone,
    from,
    to,
    type: slotConfigOf(type),
    rules: rules.map((rule) => ({
      resourceId: rule.resourceId,
      weekday: rule.weekday,
      start: rule.startTime,
      end: rule.endTime,
    })),
    businessHours: settings.businessHours ?? null,
    busy,
    blackouts: blackouts.map((row) => ({
      resourceId: row.resourceId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
    now,
  });
}

/**
 * Who the booking belongs to, when the caller already knows.
 *
 * A reschedule is not a new lead: the visitor is the same person, moving an
 * appointment they already made. Passing their identity here is what makes
 * the reserve below skip `recordLeadSubmission` entirely — no second deal,
 * no second `lead_submissions` row, and no `lead.received` re-firing a
 * welcome automation at someone who has been a customer for a month.
 */
export type ReserveIdentity = {
  contactId: string;
  dealId: string | null;
  leadSubmissionId: string | null;
};

type ReserveOptions = {
  identity?: ReserveIdentity;
  /** The booking this one replaces — excluded from every availability and
   * clash check, since it must not block its own replacement. */
  exclude?: BusyExclusion;
  /** Written onto the new row, so the chain is one insert rather than an
   * insert and a follow-up update. */
  rescheduledFromId?: string;
  /** The message that came with the original booking, for the agenda row. */
  message?: string | null;
};

/**
 * Reserve a slot.
 *
 * The contact is upserted *before* the slot transaction, deliberately. If the
 * visitor then loses the race for the slot they still exist in the CRM as
 * someone who tried to book — which is the outcome the owner wants, and the
 * opposite of the silence §5.2.4 exists to end.
 *
 * The *deal* is not. It is opened after the booking commits (through
 * `finalizeLeadSubmission`), because a deal in the pipeline and a
 * `lead_received` welcome flow are promises about an appointment that in the
 * losing case does not exist. The submission row stays either way: a record
 * that someone tried is worth keeping; a deal for a booking that failed is
 * not.
 */
export async function reserveBooking(
  ctx: TenantContext,
  input: ReserveInput,
  now: Date = new Date(),
): Promise<ReserveResult> {
  return performReserve(ctx, input, {}, now);
}

async function performReserve(
  ctx: TenantContext,
  input: ReserveInput,
  options: ReserveOptions,
  now: Date = new Date(),
): Promise<ReserveResult> {
  const type = await getBookingType(ctx, input.bookingTypeId);
  if (!type) throw new BookingError("notFound");
  if (!type.isActive) throw new BookingError("inactive");

  const tenant = await getTenant(ctx.tenantId);
  if (!tenant) throw new BookingError("notFound");
  const timeZone = tenant.timezone;
  const day = dayKeyOf(input.startsAt, timeZone);

  // Authoritative availability: the offered slot is re-derived server-side.
  // A start time posted by hand that was never on offer is refused here, not
  // trusted because it arrived in the body.
  const slots = await availableSlots(ctx, type, day, day, now, options.exclude);
  const slot = slots.find((candidate) => candidate.startsAt.getTime() === input.startsAt.getTime());
  if (!slot) throw new BookingError("slotUnavailable");

  const load = await bookingsPerResourceOn(
    ctx,
    slot.resourceIds,
    input.startsAt,
    timeZone,
    options.exclude?.bookingId,
  );
  const resourceId = pickResource(type.assignment, slot.resourceIds, load);
  if (!resourceId) throw new BookingError("slotUnavailable");

  const resource = await getResource(ctx, resourceId);
  if (!resource) throw new BookingError("slotUnavailable");

  const settings = resolveBookingTypeSettings(type.settings as never);
  const endsAt = new Date(input.startsAt.getTime() + type.durationMinutes * 60_000);

  const dealDefaults = {
    pipelineId: type.createDeal ? type.defaultPipelineId : null,
    stageId: type.createDeal ? type.defaultStageId : null,
    ownerUserId: type.defaultOwnerUserId,
    tagIds: (type.defaultTagIds as string[] | null) ?? [],
    dealTitle: `${type.name} — ${input.name}`,
  };

  // A reschedule carries the original's identity forward; a first booking
  // records the lead, minus the outcome half (see the doc comment above).
  const identity: ReserveIdentity =
    options.identity ??
    (await (async () => {
      const lead = await recordLeadSubmission(ctx, {
        bookingTypeId: type.id,
        name: input.name,
        phone: input.phone,
        email: input.email,
        message: input.message,
        source: input.source || "booking",
        utm: input.utm,
        pageUrl: input.pageUrl,
        referrer: input.referrer,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        deferOutcome: true,
        payload: { ...(input.answers ?? {}), startsAt: input.startsAt.toISOString() },
        defaults: dealDefaults,
      });
      return {
        contactId: lead.contactId,
        dealId: null,
        leadSubmissionId: lead.submissionId,
      };
    })());

  const bookingId = newId();
  const eventId = newId();
  const token = newToken();
  const description = options.message ?? input.message ?? null;

  await tenantTransaction(ctx, async (tx) => {
    // Serialise every reserve for this resource against every other one, by
    // locking a row that always exists: the resource itself.
    //
    // The FOR UPDATE over `bookings` below cannot do that on its own. On a
    // day with no committed bookings in range it matches nothing, so InnoDB
    // takes only gap locks — which are *compatible* with each other. Two
    // partially-overlapping reserves both read an empty set, both pass the
    // clash check, and then deadlock on the inserts: a 500 where a 409 was
    // designed. A real record lock on `booking_resources` is what makes the
    // read-then-write actually atomic per resource.
    await tx.selectForUpdate(bookingResources, eq(bookingResources.id, resourceId));

    // Lock the resource's live bookings for the day, then re-check overlap.
    // The unique index on active_slot is the backstop for the identical-start
    // double-click; this is what catches genuine partial overlap.
    const dayStart = new Date(input.startsAt.getTime() - 24 * 60 * 60_000);
    const dayEnd = new Date(input.startsAt.getTime() + 24 * 60 * 60_000);
    const live = await tx.selectForUpdate(
      bookings,
      and(
        eq(bookings.resourceId, resourceId),
        eq(bookings.status, "confirmed"),
        lt(bookings.startsAt, dayEnd),
        gt(bookings.endsAt, dayStart),
        // The booking being moved is still confirmed at this point — it is
        // cancelled only once its replacement is safely committed — so it has
        // to be excluded here too, or a reschedule clashes with itself.
        ...(options.exclude ? [ne(bookings.id, options.exclude.bookingId)] : []),
      ),
    );

    const clash = live.some(
      (row) => row.startsAt < endsAt && input.startsAt < row.endsAt,
    );
    if (clash) throw new BookingError("slotTaken");

    await tx.insert(calendarEvents).values({
      id: eventId,
      title: `${type.name} — ${input.name}`,
      description,
      startsAt: input.startsAt,
      endsAt,
      allDay: false,
      location: type.locationDetail ?? null,
      contactId: identity.contactId,
      dealId: identity.dealId,
      // A rep's booking lands on their agenda; a room's lands on the
      // business's, which is what a null assignee already means (§ calendar).
      assignedUserId: resource.userId,
      createdByUserId: ctx.userId,
    });

    await tx.insert(bookings).values({
      id: bookingId,
      bookingTypeId: type.id,
      resourceId,
      contactId: identity.contactId,
      calendarEventId: eventId,
      dealId: identity.dealId,
      leadSubmissionId: identity.leadSubmissionId,
      rescheduledFromId: options.rescheduledFromId ?? null,
      startsAt: input.startsAt,
      endsAt,
      status: "confirmed",
      publicToken: token,
      answers: input.answers ?? {},
      source: input.source || "booking",
      utm: (input.utm ?? {}) as object,
      pageUrl: input.pageUrl ?? null,
      referrer: input.referrer ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      activeSlot: slotKey(resourceId, input.startsAt),
    });
  }).catch((error: unknown) => {
    // The unique index fired: someone took this exact start between the read
    // and the write. That is a 409 to the visitor, not a 500.
    if (isDuplicateSlot(error)) throw new BookingError("slotTaken");
    throw error;
  });

  // The booking exists. Only now does the visitor become a lead with a deal
  // and a welcome flow — and only on a first booking; a move is not a lead.
  let dealId = identity.dealId;
  if (!options.identity && identity.leadSubmissionId) {
    dealId = await finalizeLeadSubmission(ctx, identity.leadSubmissionId, dealDefaults);
    if (dealId) {
      await tenantDb(ctx)
        .update(bookings)
        .set({ dealId })
        .where(eq(bookings.id, bookingId));
      await tenantDb(ctx)
        .update(calendarEvents)
        .set({ dealId })
        .where(eq(calendarEvents.id, eventId));
    }
  }

  await createActivity(ctx, {
    contactId: identity.contactId,
    dealId: dealId ?? undefined,
    type: "booking",
    payload: {
      bookingId,
      bookingTypeId: type.id,
      startsAt: input.startsAt.toISOString(),
      status: "confirmed",
    },
  });

  if (settings.reminderMinutes) {
    const runAt = new Date(input.startsAt.getTime() - settings.reminderMinutes * 60_000);
    if (runAt.getTime() > now.getTime()) {
      const jobId = await enqueue(
        BOOKING_REMINDER_JOB_TYPE,
        { tenantId: ctx.tenantId, bookingId },
        { tenantId: ctx.tenantId, runAt },
      );
      await tenantDb(ctx)
        .update(bookings)
        .set({ reminderJobId: jobId })
        .where(eq(bookings.id, bookingId));
    }
  }

  await bookingEvents.emit("booking.created", {
    tenantId: ctx.tenantId,
    bookingId,
    bookingTypeId: type.id,
    contactId: identity.contactId,
    resourceId,
    startsAt: input.startsAt,
    rescheduledFromId: options.rescheduledFromId ?? null,
  });

  // Read last, not first: the deal backfill and the reminder job both write
  // to this row, and the caller is handed the row as it stands.
  const booking = await getBooking(ctx, bookingId);
  if (!booking) throw new BookingError("notFound");

  return { booking, contactId: identity.contactId, dealId };
}

/**
 * The three ways MySQL says "someone else got there first" on this path.
 *
 * `ER_DUP_ENTRY` is the unique index on `active_slot` firing for an
 * identical start. The other two are the lock above doing its job under
 * contention: a loser rolled back by the deadlock detector, or one that
 * waited out `innodb_lock_wait_timeout`. All three mean the same thing to
 * the visitor — the slot went — and all three are a 409, never a 500.
 */
function isDuplicateSlot(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return (
    code === "ER_DUP_ENTRY" ||
    code === "ER_LOCK_DEADLOCK" ||
    code === "ER_LOCK_WAIT_TIMEOUT"
  );
}

async function bookingsPerResourceOn(
  ctx: TenantContext,
  resourceIds: string[],
  startsAt: Date,
  timeZone: string,
  excludeBookingId?: string,
): Promise<Map<string, number>> {
  const day = dayKeyOf(startsAt, timeZone);
  const from = new Date(startsAt.getTime() - 36 * 60 * 60_000);
  const to = new Date(startsAt.getTime() + 36 * 60 * 60_000);
  const rows = await tenantDb(ctx).select(
    bookings,
    and(
      inArray(bookings.resourceId, resourceIds),
      eq(bookings.status, "confirmed"),
      gt(bookings.startsAt, from),
      lt(bookings.startsAt, to),
      // A booking being moved must not count against its own resource's load
      // for the day, or the least-busy pick would send the replacement to
      // someone else.
      ...(excludeBookingId ? [ne(bookings.id, excludeBookingId)] : []),
    ),
  );

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (dayKeyOf(row.startsAt, timeZone) !== day) continue;
    counts.set(row.resourceId, (counts.get(row.resourceId) ?? 0) + 1);
  }
  return counts;
}

export async function getBooking(ctx: TenantContext, id: string): Promise<Booking | null> {
  const [row] = await tenantDb(ctx).select(bookings, eq(bookings.id, id)).limit(1);
  return row ?? null;
}

export async function listBookings(
  ctx: TenantContext,
  filters: { from?: Date; to?: Date; status?: Booking["status"]; contactId?: string } = {},
): Promise<Booking[]> {
  const rows = await tenantDb(ctx).select(bookings);
  return rows
    .filter((row) => {
      if (filters.from && row.endsAt <= filters.from) return false;
      if (filters.to && row.startsAt >= filters.to) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.contactId && row.contactId !== filters.contactId) return false;
      return true;
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Cancel. Frees the slot (`active_slot` → NULL, so the unique index stops
 * holding it) and deletes the agenda row — the calendar should not show
 * cancelled things — while this row keeps who, when and why.
 */
export async function cancelBooking(
  ctx: TenantContext,
  id: string,
  by: "contact" | "staff" | "system",
  reason?: string,
  now: Date = new Date(),
): Promise<Booking | null> {
  const booking = await getBooking(ctx, id);
  if (!booking) throw new BookingError("notFound");
  if (booking.status === "cancelled") throw new BookingError("alreadyCancelled");

  if (by === "contact") {
    const type = await getBookingType(ctx, booking.bookingTypeId);
    const settings = resolveBookingTypeSettings(type?.settings as never);
    const cutoff = booking.startsAt.getTime() - settings.cancellationCutoffMinutes * 60_000;
    // A hard cutoff is what stops an 08:55 cancellation for a 09:00 slot.
    // Staff can always cancel; only the visitor's own link is bounded.
    if (now.getTime() > cutoff) throw new BookingError("cutoffPassed");
  }

  await tenantDb(ctx)
    .update(bookings)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: by,
      cancelReason: reason ?? null,
      activeSlot: null,
      calendarEventId: null,
      updatedAt: now,
    })
    .where(eq(bookings.id, id));

  if (booking.calendarEventId) {
    await tenantDb(ctx).delete(calendarEvents, eq(calendarEvents.id, booking.calendarEventId));
  }

  await createActivity(ctx, {
    contactId: booking.contactId,
    dealId: booking.dealId ?? undefined,
    type: "booking",
    payload: {
      bookingId: id,
      status: "cancelled",
      cancelledBy: by,
      startsAt: booking.startsAt.toISOString(),
    },
  });

  await bookingEvents.emit("booking.cancelled", {
    tenantId: ctx.tenantId,
    bookingId: id,
    bookingTypeId: booking.bookingTypeId,
    contactId: booking.contactId,
    resourceId: booking.resourceId,
    startsAt: booking.startsAt,
    cancelledBy: by,
    cancelReason: reason ?? null,
  });

  return getBooking(ctx, id);
}

/**
 * Move a booking. Reserve the new slot **first**, cancel the old one second,
 * linked by `rescheduled_from_id` — a chain rather than a mutated row, so
 * "it was moved twice" is answerable.
 *
 * The order is the whole point. Cancel-first with a pre-check still loses:
 * the slot can go between the check and the reserve, and a self-overlapping
 * nudge skipped the check altogether, so the residual failure cancelled the
 * visitor's appointment and created nothing. The one outcome a reschedule
 * must never produce was the one it produced under load. Reserving first
 * means the worst case is the visitor keeping the appointment they had.
 *
 * The cost is a brief double-hold on the agenda — two events between the
 * insert and the cancel — which is accepted: a duplicate for a few
 * milliseconds is recoverable, a lost appointment is not.
 *
 * The visitor's identity, deal and lead submission come with them. A move is
 * not a new lead, and nothing downstream should treat it as one.
 */
export async function rescheduleBooking(
  ctx: TenantContext,
  id: string,
  startsAt: Date,
  by: "contact" | "staff",
  now: Date = new Date(),
): Promise<ReserveResult> {
  const original = await getBooking(ctx, id);
  if (!original) throw new BookingError("notFound");
  if (original.status === "cancelled") throw new BookingError("alreadyCancelled");
  if (startsAt.getTime() === original.startsAt.getTime()) {
    // Nothing to move. Refused here rather than run, because the cancel at
    // the end would otherwise retire a booking for its own duplicate.
    throw new BookingError("sameSlot");
  }

  const type = await getBookingType(ctx, original.bookingTypeId);
  if (!type) throw new BookingError("notFound");

  // The cutoff, checked up front. The cancel below is `system`/`rescheduled`
  // and so bypasses it by design; a visitor who may no longer cancel may no
  // longer move the slot either, and that has to be decided before anything
  // is written.
  if (by === "contact") {
    const settings = resolveBookingTypeSettings(type.settings as never);
    const cutoff = original.startsAt.getTime() - settings.cancellationCutoffMinutes * 60_000;
    if (now.getTime() > cutoff) throw new BookingError("cutoffPassed");
  }

  const contact = await contactOf(ctx, original.contactId);
  const message = await originalMessage(ctx, original.leadSubmissionId);

  const result = await performReserve(
    ctx,
    {
      bookingTypeId: original.bookingTypeId,
      startsAt,
      name: contact.name,
      phone: contact.phone,
      email: contact.email ?? undefined,
      message: message ?? undefined,
      answers: (original.answers as Record<string, unknown> | null) ?? undefined,
      utm: (original.utm as LeadUtm | null) ?? undefined,
      pageUrl: original.pageUrl ?? undefined,
      referrer: original.referrer ?? undefined,
      ipAddress: original.ipAddress ?? undefined,
      userAgent: original.userAgent ?? undefined,
      source: original.source ?? "booking",
    },
    {
      identity: {
        contactId: original.contactId,
        dealId: original.dealId,
        leadSubmissionId: original.leadSubmissionId,
      },
      exclude: { bookingId: original.id, calendarEventId: original.calendarEventId },
      rescheduledFromId: original.id,
      message,
    },
    now,
  );

  // Only now. Everything above can throw — slotUnavailable, slotTaken — and
  // the visitor keeps the booking they came in with.
  //
  // `system` + `rescheduled` is a pair the automation layer reads as "this is
  // a move, not a cancellation" (modules/automations/triggers.ts), so nobody
  // is sent "sentimos que cancelaste" for changing the time.
  await cancelBooking(ctx, id, "system", "rescheduled", now);

  return { ...result, booking: (await getBooking(ctx, result.booking.id))! };
}

/** The note the visitor left when they first booked, so the moved agenda
 * entry still carries it. */
async function originalMessage(
  ctx: TenantContext,
  leadSubmissionId: string | null,
): Promise<string | null> {
  if (!leadSubmissionId) return null;
  const [row] = await tenantDb(ctx).select(
    leadSubmissions,
    eq(leadSubmissions.id, leadSubmissionId),
  );
  return row?.notes ?? null;
}

async function contactOf(ctx: TenantContext, contactId: string) {
  const contact = await getContact(ctx, contactId);
  if (!contact) throw new BookingError("notFound");
  return contact;
}

/**
 * No-show is always a human's call. Nothing in the system knows the customer
 * didn't turn up, and auto-marking would quietly libel people.
 */
export async function markNoShow(ctx: TenantContext, id: string): Promise<Booking | null> {
  const booking = await getBooking(ctx, id);
  if (!booking) throw new BookingError("notFound");

  await tenantDb(ctx)
    .update(bookings)
    .set({ status: "no_show", activeSlot: null, updatedAt: new Date() })
    .where(eq(bookings.id, id));

  await createActivity(ctx, {
    contactId: booking.contactId,
    dealId: booking.dealId ?? undefined,
    type: "booking",
    payload: { bookingId: id, status: "no_show", startsAt: booking.startsAt.toISOString() },
  });

  await bookingEvents.emit("booking.no_show", {
    tenantId: ctx.tenantId,
    bookingId: id,
    bookingTypeId: booking.bookingTypeId,
    contactId: booking.contactId,
    resourceId: booking.resourceId,
    startsAt: booking.startsAt,
  });

  return getBooking(ctx, id);
}

export async function markCompleted(ctx: TenantContext, id: string): Promise<Booking | null> {
  await tenantDb(ctx)
    .update(bookings)
    .set({ status: "completed", activeSlot: null, updatedAt: new Date() })
    .where(eq(bookings.id, id));
  return getBooking(ctx, id);
}
