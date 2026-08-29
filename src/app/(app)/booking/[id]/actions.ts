"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createService, deleteService, toggleService } from "@/modules/booking/services";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { slugify } from "@/lib/slug";
import {
  bookingQuestionSchema,
  getBookingType,
  getBookingTypeBySlug,
  updateBookingType,
  type BookingQuestion,
} from "@/modules/booking/types";

// The whole booking-type row, editable (docs/SPEC-BOOKING.md §2). The create
// form on /booking asks for a name, a slug and a duration because that is
// what it takes to publish a page; everything else — buffers, notice,
// assignment, routing, questions, Turnstile, reminders — is configured here.
//
// useActionState-shaped (PLAN.md §10 1R #6): a bad number comes back inline
// on the field's own form instead of throwing to Next's error page.

export type FormState = { error: string | null; saved: boolean; values: Record<string, string> };

const empty: FormState = { error: null, saved: false, values: {} };

const settingsSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().max(100),
  description: z.string().max(2000),
  isActive: z.boolean(),
  color: z.string().max(20),

  durationMinutes: z.coerce.number().int().min(1).max(60 * 12),
  bufferBeforeMinutes: z.coerce.number().int().min(0).max(60 * 12),
  bufferAfterMinutes: z.coerce.number().int().min(0).max(60 * 12),
  // Blank means "same as the duration", which is what the column's NULL
  // already means — so an empty field is not an error.
  slotIncrementMinutes: z.coerce.number().int().min(1).max(60 * 12).nullable(),
  minNoticeMinutes: z.coerce.number().int().min(0).max(60 * 24 * 365),
  maxAdvanceDays: z.coerce.number().int().min(1).max(730),
  maxPerDay: z.coerce.number().int().min(1).max(500).nullable(),
  capacity: z.coerce.number().int().min(1).max(500),
  // Whole guaraníes, never a float — the same money rule the quotes module
  // follows. Blank means no seña.
  depositAmount: z.coerce.number().int().min(0).max(1_000_000_000).nullable(),
  allowMultiService: z.boolean(),

  assignment: z.enum(["any", "round_robin"]),
  locationMode: z.enum(["in_person", "phone", "video", "whatsapp"]),
  locationDetail: z.string().max(500),

  createDeal: z.boolean(),
  defaultPipelineId: z.string().max(26),
  defaultStageId: z.string().max(26),
  defaultOwnerUserId: z.string().max(26),
  defaultTagIds: z.array(z.string().max(26)).max(20),

  turnstileSiteId: z.string().max(26),
  requireTurnstile: z.boolean(),
  // 0 is "no reminder", which resolveBookingTypeSettings already reads as
  // deliberate rather than as an unset field.
  reminderMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30),
  cancellationCutoffMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30),
  /** How long an unpaid seña holds its slot before the job releases it. */
  depositExpiryMinutes: z.coerce.number().int().min(5).max(60 * 24 * 7),
  confirmationMessage: z.string().max(2000),
});

function optionalNumber(raw: FormDataEntryValue | null): number | null {
  const value = String(raw ?? "").trim();
  return value === "" ? null : Number(value);
}

export async function saveBookingTypeAction(
  id: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireTenantAdmin();

  const existing = await getBookingType(ctx, id);
  if (!existing) return { error: "notFound", saved: false, values: {} };

  const raw = {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    isActive: formData.get("isActive") === "on",
    color: String(formData.get("color") ?? ""),

    durationMinutes: String(formData.get("durationMinutes") ?? ""),
    bufferBeforeMinutes: String(formData.get("bufferBeforeMinutes") ?? "0"),
    bufferAfterMinutes: String(formData.get("bufferAfterMinutes") ?? "0"),
    slotIncrementMinutes: optionalNumber(formData.get("slotIncrementMinutes")),
    minNoticeMinutes: String(formData.get("minNoticeMinutes") ?? "0"),
    maxAdvanceDays: String(formData.get("maxAdvanceDays") ?? "60"),
    maxPerDay: optionalNumber(formData.get("maxPerDay")),
    capacity: String(formData.get("capacity") ?? "1"),
    depositAmount: optionalNumber(formData.get("depositAmount")),
    allowMultiService: formData.get("allowMultiService") === "on",

    assignment: String(formData.get("assignment") ?? "any"),
    locationMode: String(formData.get("locationMode") ?? "in_person"),
    locationDetail: String(formData.get("locationDetail") ?? ""),

    createDeal: formData.get("createDeal") === "on",
    defaultPipelineId: String(formData.get("defaultPipelineId") ?? ""),
    defaultStageId: String(formData.get("defaultStageId") ?? ""),
    defaultOwnerUserId: String(formData.get("defaultOwnerUserId") ?? ""),
    defaultTagIds: formData.getAll("defaultTagIds").map(String).filter(Boolean),

    turnstileSiteId: String(formData.get("turnstileSiteId") ?? ""),
    requireTurnstile: formData.get("requireTurnstile") === "on",
    reminderMinutes: String(formData.get("reminderMinutes") ?? "0"),
    cancellationCutoffMinutes: String(formData.get("cancellationCutoffMinutes") ?? "120"),
    depositExpiryMinutes: String(formData.get("depositExpiryMinutes") ?? "120"),
    confirmationMessage: String(formData.get("confirmationMessage") ?? ""),
  };

  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return {
      error: field === "name" ? "nameRequired" : field === "durationMinutes" ? "durationInvalid" : "invalidNumber",
      saved: false,
      values: { field },
    };
  }
  const data = parsed.data;

  const questions = readQuestions(formData);
  if (!questions.ok) return { error: "invalidQuestion", saved: false, values: {} };

  const slug = slugify(data.slug || data.name);
  // Checked here rather than left to the unique index, so the admin gets the
  // reason on the form instead of a 500 from a duplicate-key error.
  const clash = await getBookingTypeBySlug(ctx, slug);
  if (clash && clash.id !== id) return { error: "slugTaken", saved: false, values: {} };

  await updateBookingType(ctx, id, {
    name: data.name,
    slug,
    description: data.description || null,
    isActive: data.isActive,
    color: data.color || null,

    durationMinutes: data.durationMinutes,
    bufferBeforeMinutes: data.bufferBeforeMinutes,
    bufferAfterMinutes: data.bufferAfterMinutes,
    slotIncrementMinutes: data.slotIncrementMinutes,
    minNoticeMinutes: data.minNoticeMinutes,
    maxAdvanceDays: data.maxAdvanceDays,
    maxPerDay: data.maxPerDay,
    capacity: data.capacity,
    depositAmount: data.depositAmount,
    allowMultiService: data.allowMultiService,

    assignment: data.assignment,
    locationMode: data.locationMode,
    locationDetail: data.locationDetail || null,

    createDeal: data.createDeal,
    // A stage that belongs to another pipeline would route a booking into a
    // board it can't be seen on, so it is dropped rather than saved.
    defaultPipelineId: data.defaultPipelineId || null,
    defaultStageId: data.defaultPipelineId ? data.defaultStageId || null : null,
    defaultOwnerUserId: data.defaultOwnerUserId || null,
    defaultTagIds: data.defaultTagIds,

    questions: questions.questions,
    settings: {
      turnstileSiteId: data.turnstileSiteId || undefined,
      requireTurnstile: data.requireTurnstile,
      reminderMinutes: data.reminderMinutes,
      cancellationCutoffMinutes: data.cancellationCutoffMinutes,
      depositExpiryMinutes: data.depositExpiryMinutes,
      confirmationMessage: data.confirmationMessage || undefined,
    },
  });

  revalidatePath("/booking");
  revalidatePath(`/booking/${id}`);
  return { ...empty, saved: true };
}

/**
 * The custom questions, read off parallel field arrays. Every row posts all
 * four values — `required` is a select rather than a checkbox precisely so
 * the arrays stay index-aligned when a row says "no".
 */
function readQuestions(
  formData: FormData,
): { ok: true; questions: BookingQuestion[] } | { ok: false } {
  const keys = formData.getAll("qKey").map(String);
  const labels = formData.getAll("qLabel").map(String);
  const types = formData.getAll("qType").map(String);
  const required = formData.getAll("qRequired").map(String);
  const options = formData.getAll("qOptions").map(String);

  const questions: BookingQuestion[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]?.trim();
    const label = labels[index]?.trim();
    // A wholly blank row is how the editor says "nothing here", not an error.
    if (!key && !label) continue;

    const parsed = bookingQuestionSchema.safeParse({
      key: slugify(key || label || "").replace(/-/g, "_"),
      label: label || key,
      type: types[index],
      required: required[index] === "1",
      options: (options[index] ?? "")
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean),
    });
    if (!parsed.success) return { ok: false };
    if (parsed.data.type !== "select") delete parsed.data.options;
    if (questions.some((question) => question.key === parsed.data.key)) return { ok: false };
    questions.push(parsed.data);
  }

  return { ok: true, questions };
}

// Add-on services (plan-booking.md §5.2). Separate actions rather than fields
// on the big settings form: a list that grows and shrinks does not fit the
// "one form, one save" shape the rest of the page has, and mixing them would
// mean a failed validation on the duration wiping a half-typed add-on.

export async function createServiceAction(bookingTypeId: string, formData: FormData) {
  const ctx = await requireTenantAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await createService(ctx, {
    bookingTypeId,
    name,
    extraDurationMinutes: Number(formData.get("extraDurationMinutes") ?? 0) || 0,
    extraPrice: Number(formData.get("extraPrice") ?? 0) || null,
    sort: Number(formData.get("sort") ?? 0) || 0,
  });

  revalidatePath(`/booking/${bookingTypeId}`);
}

export async function deleteServiceAction(bookingTypeId: string, serviceId: string) {
  const ctx = await requireTenantAdmin();
  // Deleted, not soft-deleted: bookings snapshot their services onto the row
  // (`bookings.services`), so removing the definition cannot rewrite what a
  // customer was told they were buying.
  await deleteService(ctx, serviceId);
  revalidatePath(`/booking/${bookingTypeId}`);
}

export async function toggleServiceAction(
  bookingTypeId: string,
  serviceId: string,
  isActive: boolean,
) {
  const ctx = await requireTenantAdmin();
  await toggleService(ctx, serviceId, isActive);
  revalidatePath(`/booking/${bookingTypeId}`);
}
