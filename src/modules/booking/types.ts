import { eq } from "drizzle-orm";
import { z } from "zod";
import { bookingTypes } from "@/db/schema";
import { newId } from "@/lib/ids";
import { slugify } from "@/lib/slug";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { BookingConfigError } from "./resources";

// Booking types: one row is one public booking page (docs/SPEC-BOOKING.md §2).

export type BookingType = typeof bookingTypes.$inferSelect;

/**
 * Per-type settings, resolved at *read* with safe defaults — the same
 * discipline modules/ai/config.ts uses, so a row written before a field
 * existed behaves exactly like a new one rather than like a misconfiguration.
 */
export type BookingTypeSettings = {
  /** Whose Turnstile credentials this page borrows (§5.2.1: credentials, not provenance). */
  turnstileSiteId?: string;
  requireTurnstile?: boolean;
  /** Minutes before the start to send the WhatsApp reminder. 0/absent = none. */
  reminderMinutes?: number;
  /** A visitor may not cancel inside this many minutes of the start. */
  cancellationCutoffMinutes?: number;
  confirmationMessage?: string;
  /**
   * How long a `pending_deposit` reservation holds its slot before the
   * expiry job releases it (plan-booking.md §5.2). Absent = the default
   * below; a business that takes transfers overnight can raise it.
   */
  depositExpiryMinutes?: number;
};

export const DEFAULT_CANCELLATION_CUTOFF_MINUTES = 120;
export const DEFAULT_REMINDER_MINUTES = 24 * 60;
/** Long enough to walk to a bank, short enough not to lose the evening. */
export const DEFAULT_DEPOSIT_EXPIRY_MINUTES = 120;

export type ResolvedBookingTypeSettings = Required<
  Pick<
    BookingTypeSettings,
    "requireTurnstile" | "cancellationCutoffMinutes" | "depositExpiryMinutes"
  >
> & {
  turnstileSiteId: string | null;
  reminderMinutes: number | null;
  confirmationMessage: string | null;
};

export function resolveBookingTypeSettings(
  settings: BookingTypeSettings | null | undefined,
): ResolvedBookingTypeSettings {
  const reminder = settings?.reminderMinutes;
  return {
    turnstileSiteId: settings?.turnstileSiteId || null,
    requireTurnstile: settings?.requireTurnstile === true,
    reminderMinutes:
      typeof reminder === "number" && Number.isFinite(reminder) && reminder > 0
        ? Math.floor(reminder)
        : reminder === 0
          ? null
          : DEFAULT_REMINDER_MINUTES,
    cancellationCutoffMinutes: clampNonNegative(
      settings?.cancellationCutoffMinutes,
      DEFAULT_CANCELLATION_CUTOFF_MINUTES,
    ),
    depositExpiryMinutes: Math.max(
      1,
      clampNonNegative(settings?.depositExpiryMinutes, DEFAULT_DEPOSIT_EXPIRY_MINUTES),
    ),
    confirmationMessage: settings?.confirmationMessage?.trim() || null,
  };
}

function clampNonNegative(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

/** One extra question on the public form, in the shape `forms.fields` uses. */
export const bookingQuestionSchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(200),
  type: z.enum(["text", "textarea", "select", "email"]),
  required: z.boolean().optional(),
  options: z.array(z.string().max(200)).max(30).optional(),
});
export type BookingQuestion = z.infer<typeof bookingQuestionSchema>;

export type BookingTypeInput = {
  name: string;
  slug?: string;
  description?: string | null;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  slotIncrementMinutes?: number | null;
  minNoticeMinutes?: number;
  maxAdvanceDays?: number;
  maxPerDay?: number | null;
  /** Places per start. 1 keeps the one-at-a-time behaviour. */
  capacity?: number;
  /** Seña in whole guaraníes; null/0 means the booking confirms immediately. */
  depositAmount?: number | null;
  allowMultiService?: boolean;
  assignment?: "any" | "round_robin";
  locationMode?: "in_person" | "phone" | "video" | "whatsapp";
  locationDetail?: string | null;
  createDeal?: boolean;
  defaultPipelineId?: string | null;
  defaultStageId?: string | null;
  defaultTagIds?: string[];
  defaultOwnerUserId?: string | null;
  questions?: BookingQuestion[];
  settings?: BookingTypeSettings;
  isActive?: boolean;
  color?: string | null;
};

export async function listBookingTypes(ctx: TenantContext): Promise<BookingType[]> {
  return tenantDb(ctx).select(bookingTypes).orderBy(bookingTypes.name);
}

export async function getBookingType(
  ctx: TenantContext,
  id: string,
): Promise<BookingType | null> {
  const [row] = await tenantDb(ctx).select(bookingTypes, eq(bookingTypes.id, id)).limit(1);
  return row ?? null;
}

export async function getBookingTypeBySlug(
  ctx: TenantContext,
  slug: string,
): Promise<BookingType | null> {
  const [row] = await tenantDb(ctx).select(bookingTypes, eq(bookingTypes.slug, slug)).limit(1);
  return row ?? null;
}

export async function createBookingType(
  ctx: TenantContext,
  input: BookingTypeInput,
): Promise<BookingType | null> {
  if (ctx.role !== "admin") throw new BookingConfigError("forbidden");
  const id = newId();
  await tenantDb(ctx)
    .insert(bookingTypes)
    .values({ id, ...toRow(input) });
  return getBookingType(ctx, id);
}

export async function updateBookingType(
  ctx: TenantContext,
  id: string,
  input: BookingTypeInput,
): Promise<BookingType | null> {
  if (ctx.role !== "admin") throw new BookingConfigError("forbidden");
  const existing = await getBookingType(ctx, id);
  if (!existing) throw new BookingConfigError("notFound");

  await tenantDb(ctx)
    .update(bookingTypes)
    .set({ ...toRow(input), updatedAt: new Date() })
    .where(eq(bookingTypes.id, id));
  return getBookingType(ctx, id);
}

function toRow(input: BookingTypeInput) {
  return {
    name: input.name,
    slug: slugify(input.slug || input.name),
    description: input.description ?? null,
    isActive: input.isActive ?? true,
    color: input.color ?? null,
    durationMinutes: input.durationMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
    bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
    slotIncrementMinutes: input.slotIncrementMinutes ?? null,
    minNoticeMinutes: input.minNoticeMinutes ?? 120,
    maxAdvanceDays: input.maxAdvanceDays ?? 60,
    maxPerDay: input.maxPerDay ?? null,
    capacity: Math.max(1, Math.floor(input.capacity ?? 1)),
    // 0 and null both mean "no seña"; storing 0 would make
    // `depositAmount > 0` the only safe test everywhere downstream.
    depositAmount: input.depositAmount && input.depositAmount > 0 ? input.depositAmount : null,
    allowMultiService: input.allowMultiService ?? false,
    assignment: input.assignment ?? "any",
    locationMode: input.locationMode ?? "in_person",
    locationDetail: input.locationDetail ?? null,
    createDeal: input.createDeal ?? false,
    defaultPipelineId: input.defaultPipelineId ?? null,
    defaultStageId: input.defaultStageId ?? null,
    defaultTagIds: input.defaultTagIds ?? [],
    defaultOwnerUserId: input.defaultOwnerUserId ?? null,
    questions: input.questions ?? [],
    settings: input.settings ?? {},
  };
}

/** The slot generator's config, read off the row with its defaults applied. */
export function slotConfigOf(type: BookingType) {
  return {
    durationMinutes: type.durationMinutes,
    bufferBeforeMinutes: type.bufferBeforeMinutes,
    bufferAfterMinutes: type.bufferAfterMinutes,
    slotIncrementMinutes: type.slotIncrementMinutes || type.durationMinutes,
    minNoticeMinutes: type.minNoticeMinutes,
    maxAdvanceDays: type.maxAdvanceDays,
    maxPerDay: type.maxPerDay,
    capacity: Math.max(1, type.capacity),
  };
}
