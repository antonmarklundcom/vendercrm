import {
  mysqlTable,
  char,
  varchar,
  boolean,
  json,
  datetime,
  index,
  uniqueIndex,
  text,
  int,
  tinyint,
  bigint,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Public booking (docs/SPEC-BOOKING.md). A booking is not a new kind of
// person and not a new kind of calendar entry: it upserts a `contact` through
// the same engine lead ingest uses (§5.1 — "a lead is not a new entity"),
// writes a `calendar_events` row so the agenda sees it with no sync job, and
// keeps only the *reservation lifecycle* here — the public token, the
// cancel/no-show states, the reschedule chain. That lifecycle is exactly what
// has no business being on `calendar_events`, which the whole app reads for
// the simple case "a visit at four".
//
// Times are UTC `datetime` (§2.3); every wall-clock rule below is expressed
// in the tenant's own timezone through modules/calendar/zoned-time.ts.

/**
 * Who or what gets booked. Half this market books a *thing* — a consultorio,
 * a cancha, a grúa — not a person, and a room must not burn a plan seat
 * (§13 H6), which is why this is its own table rather than booking straight
 * against `users`.
 */
export const bookingResources = mysqlTable(
  "booking_resources",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    kind: varchar("kind", { length: 10, enum: ["user", "resource"] })
      .notNull()
      .default("user"),
    /** Set for kind='user' — the rep whose agenda this resource *is*. */
    userId: char("user_id", { length: 26 }),
    name: varchar("name", { length: 200 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("booking_resources_tenant_idx").on(table.tenantId),
    // One resource per rep, so "¿está ocupado?" has exactly one answer.
    uniqueIndex("booking_resources_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

/**
 * What can be booked. One row is one public booking page.
 *
 * The routing defaults (pipeline, stage, tags, owner) are read from here and
 * never from the request body — §5.1's rule that a leaked or guessed public
 * credential cannot reshape someone's pipeline applies to this surface too.
 */
export const bookingTypes = mysqlTable(
  "booking_types",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    /** The public URL segment: /b/[tenantSlug]/[typeSlug]. */
    slug: varchar("slug", { length: 100 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    color: varchar("color", { length: 20 }),

    durationMinutes: int("duration_minutes").notNull().default(30),
    bufferBeforeMinutes: int("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: int("buffer_after_minutes").notNull().default(0),
    /** How far apart offered starts are. Defaults to the duration. */
    slotIncrementMinutes: int("slot_increment_minutes"),

    /** Nobody wants a booking for twenty minutes from now. */
    minNoticeMinutes: int("min_notice_minutes").notNull().default(120),
    maxAdvanceDays: int("max_advance_days").notNull().default(60),
    maxPerDay: int("max_per_day"),

    /**
     * How many people fit one slot (B2 group bookings). 1 is the historical
     * behaviour and stays the default, so a barbería's chair keeps meaning
     * "one at a time" while a clase de spinning can say twelve. Capacity is
     * counted in `party_size`, not in rows: four people on one reservation
     * take four places.
     */
    capacity: int("capacity").notNull().default(1),

    /**
     * The seña (deposit) this type asks for, in guaraníes as a whole-unit
     * bigint — the same money convention the quotes module uses, never a
     * float. Null means no deposit and the booking confirms immediately.
     */
    depositAmount: bigint("deposit_amount", { mode: "number" }),
    depositCurrency: varchar("deposit_currency", { length: 3 }).notNull().default("PYG"),

    /** Whether the public page offers `booking_type_services` add-ons (B2). */
    allowMultiService: boolean("allow_multi_service").notNull().default(false),

    /**
     * How the resource is chosen when several are free. `fixed` was a third
     * value until it was dropped: a type that always wants one person says so
     * by linking exactly that one resource in `booking_type_resources`, and a
     * second way to say it (a `fixed_resource_id`) could contradict the first.
     * Migration 0024 rewrote the rows that carried it.
     */
    assignment: varchar("assignment", {
      length: 15,
      enum: ["any", "round_robin"],
    })
      .notNull()
      .default("any"),

    locationMode: varchar("location_mode", {
      length: 15,
      enum: ["in_person", "phone", "video", "whatsapp"],
    })
      .notNull()
      .default("in_person"),
    locationDetail: varchar("location_detail", { length: 500 }),

    // Per-type routing, configured in the CRM (§5.1).
    createDeal: boolean("create_deal").notNull().default(false),
    defaultPipelineId: char("default_pipeline_id", { length: 26 }),
    defaultStageId: char("default_stage_id", { length: 26 }),
    defaultTagIds: json("default_tag_ids"),
    defaultOwnerUserId: char("default_owner_user_id", { length: 26 }),

    /** Extra public-form fields, in the same shape `forms.fields` uses. */
    questions: json("questions"),
    /** { turnstileSiteId?, requireTurnstile?, reminderMinutes?,
     *    cancellationCutoffMinutes?, confirmationMessage? } */
    settings: json("settings"),

    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("booking_types_tenant_slug_idx").on(table.tenantId, table.slug),
    index("booking_types_tenant_active_idx").on(table.tenantId, table.isActive),
  ],
);

/** Which resources can serve a type. */
export const bookingTypeResources = mysqlTable(
  "booking_type_resources",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    bookingTypeId: char("booking_type_id", { length: 26 }).notNull(),
    resourceId: char("resource_id", { length: 26 }).notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("booking_type_resources_unique_idx").on(
      table.tenantId,
      table.bookingTypeId,
      table.resourceId,
    ),
    index("booking_type_resources_resource_idx").on(table.tenantId, table.resourceId),
  ],
);

/**
 * The recurring weekly offer, per resource, as **local wall clock** — so
 * "abre a las 8" survives a DST change in any timezone this is ever sold
 * into. `tenants.settings.businessHours` stores "HH:MM" for the same reason.
 *
 * Several rows per weekday are allowed, and that is how a siesta break is
 * expressed (08:00–12:00 plus 14:30–18:00) rather than a special case.
 */
export const bookingAvailabilityRules = mysqlTable(
  "booking_availability_rules",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    resourceId: char("resource_id", { length: 26 }).notNull(),
    /** 0 = Sunday, matching zoned-time's `weekdayOf`. */
    weekday: tinyint("weekday").notNull(),
    startTime: varchar("start_time", { length: 5 }).notNull(),
    endTime: varchar("end_time", { length: 5 }).notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("booking_rules_tenant_resource_idx").on(
      table.tenantId,
      table.resourceId,
      table.weekday,
    ),
  ],
);

/** Holidays, vacations, one-off closures. Null resource means the whole tenant. */
export const bookingBlackouts = mysqlTable(
  "booking_blackouts",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    resourceId: char("resource_id", { length: 26 }),
    startsAt: datetime("starts_at").notNull(),
    endsAt: datetime("ends_at").notNull(),
    reason: varchar("reason", { length: 300 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("booking_blackouts_tenant_starts_idx").on(table.tenantId, table.startsAt),
  ],
);

/**
 * The reservation. What the calendar row cannot hold.
 *
 * Cancelling sets `status='cancelled'` and deletes the `calendar_events` row
 * — the agenda should not show cancelled things — so this row is the history
 * of who cancelled, when and why. Rescheduling is cancel + create linked by
 * `rescheduled_from_id`, which makes the trail a chain rather than a mutated
 * row.
 */
export const bookings = mysqlTable(
  "bookings",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    bookingTypeId: char("booking_type_id", { length: 26 }).notNull(),
    resourceId: char("resource_id", { length: 26 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    /** The agenda row this booking *is*. Null once cancelled. */
    calendarEventId: char("calendar_event_id", { length: 26 }),
    dealId: char("deal_id", { length: 26 }),
    leadSubmissionId: char("lead_submission_id", { length: 26 }),

    startsAt: datetime("starts_at").notNull(),
    endsAt: datetime("ends_at").notNull(),

    /**
     * `pending_deposit` is a *held* reservation waiting on a seña (B2): the
     * slot is taken, nobody else can book it, and it is not yet a promise the
     * business has made. It expires back to `cancelled` if the transfer never
     * arrives, which is why it is a status and not a boolean.
     */
    status: varchar("status", {
      length: 16,
      enum: ["confirmed", "pending_deposit", "cancelled", "completed", "no_show"],
    })
      .notNull()
      .default("confirmed"),
    cancelledAt: datetime("cancelled_at"),
    cancelledBy: varchar("cancelled_by", { length: 10, enum: ["contact", "staff", "system"] }),
    cancelReason: varchar("cancel_reason", { length: 500 }),
    /** The booking this one replaced, when the visitor rescheduled. */
    rescheduledFromId: char("rescheduled_from_id", { length: 26 }),

    /** The manage/cancel link's secret — same model as /q/[token] (§8). */
    publicToken: varchar("public_token", { length: 64 }).notNull(),

    /** How many places this reservation takes against the type's capacity. */
    partySize: int("party_size").notNull().default(1),

    /** Seña bookkeeping (B2): who accepted the comprobante, and when. */
    depositConfirmedAt: datetime("deposit_confirmed_at"),
    depositConfirmedByUserId: char("deposit_confirmed_by_user_id", { length: 26 }),

    /**
     * Snapshot of the add-on services chosen at booking time, in the shape
     * `[{ id, name, extraDurationMinutes, extraPrice }]`. A snapshot, not a
     * join: renaming or repricing a service later must not rewrite what a
     * customer was told when they booked.
     */
    services: json("services"),

    answers: json("answers"),
    source: varchar("source", { length: 100 }),
    utm: json("utm"),
    pageUrl: varchar("page_url", { length: 2000 }),
    referrer: varchar("referrer", { length: 2000 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }),

    reminderJobId: char("reminder_job_id", { length: 26 }),
    reminderSentAt: datetime("reminder_sent_at"),

    /**
     * The double-booking backstop: `"<resourceId>:<startsAt epoch seconds>"`
     * while the booking is live, **NULL** once it isn't. MySQL permits
     * unlimited NULLs in a unique index, so this enforces "one live booking
     * per resource per exact start" without a partial index, and a cancelled
     * slot becomes bookable again with nothing to clean up.
     *
     * It only catches *identical* starts — the double-click and the retry.
     * Genuine partial overlap is the transactional check's job
     * (modules/booking/bookings.ts); both exist because neither alone is
     * enough.
     */
    activeSlot: varchar("active_slot", { length: 80 }),

    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("bookings_tenant_starts_idx").on(table.tenantId, table.startsAt),
    index("bookings_tenant_resource_starts_idx").on(
      table.tenantId,
      table.resourceId,
      table.startsAt,
    ),
    index("bookings_tenant_contact_idx").on(table.tenantId, table.contactId),
    index("bookings_tenant_status_idx").on(table.tenantId, table.status),
    uniqueIndex("bookings_public_token_idx").on(table.publicToken),
    uniqueIndex("bookings_tenant_active_slot_idx").on(table.tenantId, table.activeSlot),
  ],
);

/**
 * Optional add-on services a booking type can offer (B2 multi-service):
 * "barba +15 min", "lavado +10.000". Chosen services extend the duration the
 * slot search uses and are snapshotted onto `bookings.services`.
 */
export const bookingTypeServices = mysqlTable(
  "booking_type_services",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    bookingTypeId: char("booking_type_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    extraDurationMinutes: int("extra_duration_minutes").notNull().default(0),
    /** Whole guaraníes, same convention as `booking_types.deposit_amount`. */
    extraPrice: bigint("extra_price", { mode: "number" }),
    sort: int("sort").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("booking_type_services_type_idx").on(table.tenantId, table.bookingTypeId, table.sort),
  ],
);

/**
 * Every customer-facing notification this system *attempted*, whether or not
 * it went out.
 *
 * The reason this table exists rather than a flag on the booking: WhatsApp
 * delivery is a chain of fallbacks (approved template → free-form inside the
 * 24h window → email → nothing), and when a customer says "nunca me
 * avisaron" the answerable question is which rung was tried and what came
 * back. A boolean `reminder_sent_at` cannot answer it; this can, and the
 * booking view reads it straight as a timeline.
 */
export const bookingNotifications = mysqlTable(
  "booking_notifications",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    bookingId: char("booking_id", { length: 26 }).notNull(),
    kind: varchar("kind", {
      length: 20,
      enum: [
        "confirmation",
        "reminder",
        "cancellation",
        "reschedule",
        "deposit_request",
        "review_request",
      ],
    }).notNull(),
    channel: varchar("channel", {
      length: 12,
      enum: ["wa_template", "wa_freeform", "email", "none"],
    }).notNull(),
    status: varchar("status", {
      length: 10,
      enum: ["queued", "sent", "delivered", "read", "failed", "skipped"],
    })
      .notNull()
      .default("queued"),
    /** The Meta template used, when the chain landed on `wa_template`. */
    templateName: varchar("template_name", { length: 200 }),
    /** The outbound `messages` row, so status webhooks can advance this one. */
    messageId: char("message_id", { length: 26 }),
    /** Why the rung was skipped or failed — shown verbatim to staff. */
    detail: varchar("detail", { length: 500 }),
    sentAt: datetime("sent_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("booking_notifications_booking_idx").on(table.tenantId, table.bookingId),
    index("booking_notifications_message_idx").on(table.tenantId, table.messageId),
  ],
);
