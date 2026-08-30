"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { disconnectGcal, gcalAuthUrl } from "@/modules/calendar/gcal";
import { requireTenantAdmin, requireTenantContext } from "@/modules/tenancy/context";
import {
  updateTenantBranding,
  updateTenantBusinessHours,
  updateTenantTimezone,
  updateTenantDefaultCountry,
  updateTenantReviewLink,
  regenerateContactsFeedToken,
  updateTenantAiSettings,
  type BusinessHours,
} from "@/modules/tenancy/settings";
import {
  MAX_PER_CONVERSATION_PER_DAY_LIMIT,
  MAX_PER_TENANT_PER_DAY_LIMIT,
} from "@/modules/ai/config";
import { COUNTRY_CODES } from "@/lib/phone";
import { setUserTaskReminders } from "@/modules/tenancy/users";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// Every settings form on this page shares the same shape (PLAN.md §10 1R
// #6): safeParse instead of parse, an error *key* resolved client-side
// through next-intl, and a "saved" flag so a successful save is visible even
// though the form looks identical afterwards.
export type SettingsFormState = {
  error: string | null;
  saved: boolean;
  values: Record<string, string>;
};

function submitted(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

const brandingSchema = z.object({
  logoUrl: z.string().url().optional().or(z.literal("")),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
});

export async function updateBrandingAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);
  const parsed = brandingSchema.safeParse({
    logoUrl: formData.get("logoUrl") || undefined,
    primaryColor: formData.get("primaryColor") || undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "primaryColor" ? "primaryColorInvalid" : "logoUrlInvalid", saved: false, values };
  }

  try {
    await updateTenantBranding(ctx, {
      logoUrl: parsed.data.logoUrl || undefined,
      primaryColor: parsed.data.primaryColor || undefined,
    });
  } catch {
    return { error: "unknown", saved: false, values };
  }

  revalidatePath("/settings");
  return { error: null, saved: true, values };
}

export async function updateBusinessHoursAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);

  const businessHours = DAYS.reduce((acc, day) => {
    const enabled = formData.get(`${day}_enabled`) === "on";
    const start = String(formData.get(`${day}_start`) || "");
    const end = String(formData.get(`${day}_end`) || "");
    acc[day] = enabled && start && end ? { start, end } : null;
    return acc;
  }, {} as BusinessHours);

  try {
    await updateTenantBusinessHours(ctx, businessHours);
  } catch {
    return { error: "unknown", saved: false, values };
  }

  revalidatePath("/settings");
  return { error: null, saved: true, values };
}

const timezoneSchema = z.string().min(1).max(60);

export async function updateTimezoneAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);
  const parsed = timezoneSchema.safeParse(formData.get("timezone"));
  if (!parsed.success) {
    return { error: "timezoneRequired", saved: false, values };
  }

  try {
    await updateTenantTimezone(ctx, parsed.data);
  } catch {
    return { error: "unknown", saved: false, values };
  }

  revalidatePath("/settings");
  return { error: null, saved: true, values };
}

const defaultCountrySchema = z.enum(COUNTRY_CODES);

export async function updateDefaultCountryAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);
  const parsed = defaultCountrySchema.safeParse(formData.get("defaultCountry"));
  if (!parsed.success) {
    return { error: "defaultCountryInvalid", saved: false, values };
  }

  try {
    await updateTenantDefaultCountry(ctx, parsed.data);
  } catch {
    return { error: "unknown", saved: false, values };
  }

  revalidatePath("/settings");
  return { error: null, saved: true, values };
}

const reviewLinkSchema = z.string().url().max(500);

export async function updateReviewLinkAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);
  const parsed = reviewLinkSchema.safeParse(formData.get("reviewLink"));
  if (!parsed.success) {
    return { error: "reviewLinkInvalid", saved: false, values };
  }

  try {
    await updateTenantReviewLink(ctx, parsed.data);
  } catch {
    return { error: "unknown", saved: false, values };
  }

  revalidatePath("/settings");
  return { error: null, saved: true, values };
}

// AI auto-reply settings (PLAN.md §10 1O). Admin-only via requireTenantAdmin
// like every other setting here — an agent can pull the per-conversation kill
// switch from the inbox, but only an admin decides whether the tenant sends
// autonomously at all.
const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  businessName: z.string().max(200).optional(),
  about: z.string().max(2000).optional(),
  tone: z.string().max(500).optional(),
  hours: z.string().max(500).optional(),
  neverPromise: z.string().max(1000).optional(),
  mode: z.enum(["draft", "send"]),
  maxRepliesPerConversationPerDay: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_PER_CONVERSATION_PER_DAY_LIMIT),
  maxRepliesPerTenantPerDay: z.coerce.number().int().min(0).max(MAX_PER_TENANT_PER_DAY_LIMIT),
  handoffKeyword: z.string().min(1).max(50),
  /** Lets the assistant offer bookable slots (plan-booking.md §5.3). */
  bookingEnabled: z.boolean(),
});

export async function updateAiSettingsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);

  const parsed = aiSettingsSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    businessName: formData.get("businessName") || undefined,
    about: formData.get("about") || undefined,
    tone: formData.get("tone") || undefined,
    hours: formData.get("hours") || undefined,
    neverPromise: formData.get("neverPromise") || undefined,
    mode: formData.get("mode") || "draft",
    maxRepliesPerConversationPerDay: formData.get("maxRepliesPerConversationPerDay") || 3,
    maxRepliesPerTenantPerDay: formData.get("maxRepliesPerTenantPerDay") || 200,
    handoffKeyword: formData.get("handoffKeyword") || "humano",
    bookingEnabled: formData.get("bookingEnabled") === "on",
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const key =
      field === "maxRepliesPerConversationPerDay" || field === "maxRepliesPerTenantPerDay"
        ? "aiLimitInvalid"
        : field === "handoffKeyword"
          ? "aiHandoffKeywordRequired"
          : "unknown";
    return { error: key, saved: false, values };
  }

  try {
    await updateTenantAiSettings(ctx, parsed.data);
  } catch {
    return { error: "unknown", saved: false, values };
  }

  revalidatePath("/settings");
  return { error: null, saved: true, values };
}

// Contacts feed token (Google Sheets IMPORTDATA). No action state needed —
// the settings page reads the token straight from tenant settings, so
// revalidating is enough to show the new formula.
export async function regenerateFeedTokenAction() {
  const ctx = await requireTenantAdmin();
  await regenerateContactsFeedToken(ctx);
  revalidatePath("/settings");
}


/** Per-user opt-out for the daily task reminder email (PLAN.md §13 H6).
 * Not admin-gated: it's the acting user's own preference, the same shape as
 * the language switcher. */
export async function setTaskRemindersAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z
    .object({ enabled: z.enum(["true", "false"]) })
    .safeParse({ enabled: formData.get("enabled") });
  if (!parsed.success) return;

  await setUserTaskReminders(ctx.userId, parsed.data.enabled === "true");
  revalidatePath("/settings");
}

// Google Calendar busy-read (plan-booking.md §5.4). The connect half is a
// redirect to Google rather than a form post, so it lives here only to build
// the URL with the signed-in user's own state — the callback compares it
// against the session before attaching anybody's calendar.

export async function connectGcalAction(): Promise<void> {
  const ctx = await requireTenantContext();
  const url = gcalAuthUrl(`${ctx.tenantId}:${ctx.userId}`);
  // No credentials configured: the button is already disabled in the UI, so
  // reaching here means a stale page. Back to settings rather than a crash.
  redirect(url ?? "/settings?gcal=not_configured");
}

export async function disconnectGcalAction(): Promise<void> {
  const ctx = await requireTenantContext();
  await disconnectGcal(ctx, ctx.userId);
  revalidatePath("/settings");
}
