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
  updateTenantContactEmail,
  updateTenantCoachPhone,
  regenerateContactsFeedToken,
  updateTenantAiSettings,
  type BusinessHours,
} from "@/modules/tenancy/settings";
import {
  MAX_PER_CONVERSATION_PER_DAY_LIMIT,
  MAX_PER_TENANT_PER_DAY_LIMIT,
} from "@/modules/ai/config";
import { COUNTRY_CODES } from "@/lib/phone";
import { getUserById, setUserPushPrefs, setUserTaskReminders } from "@/modules/tenancy/users";
import { PUSH_KINDS, applyPushPrefs } from "@/modules/notifications/prefs";
import {
  createTenantEmailDomain,
  refreshTenantEmailDomain,
  removeTenantEmailDomain,
  setTenantEmailFromLocalPart,
} from "@/modules/tenancy/email-domains";
import { scheduleDomainVerification } from "@/modules/tenancy/email-jobs";

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

// The owner's own WhatsApp number for the voice coach (§15.3 Lane A, §15.10
// W1). Stored as typed and normalised at comparison time, so a number saved
// as "0981 123 456" still matches the "+595981123456" WhatsApp sends.
const coachPhoneSchema = z.string().trim().min(6).max(30);

export async function updateCoachPhoneAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);
  const raw = formData.get("coachPhone");
  // Empty is a valid answer: it turns the coach half off again.
  const parsed = coachPhoneSchema.safeParse(raw);
  if (typeof raw === "string" && raw.trim() === "") {
    try {
      await updateTenantCoachPhone(ctx, "");
    } catch {
      return { error: "unknown", saved: false, values };
    }
    revalidatePath("/settings");
    return { error: null, saved: true, values };
  }
  if (!parsed.success) {
    return { error: "coachPhoneInvalid", saved: false, values };
  }

  try {
    await updateTenantCoachPhone(ctx, parsed.data);
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

/**
 * Which web pushes this person wants (PLAN.md §15.5 J2). An unchecked box is
 * absent from the FormData, so the form's answer is read as "every kind that
 * is not here is off" — which is why the whole set is rebuilt from
 * PUSH_KINDS rather than from what arrived.
 *
 * Always the acting user's own row: like the language and theme settings,
 * there is no id in the payload to point at somebody else.
 */
export async function setPushPrefsAction(formData: FormData) {
  const ctx = await requireTenantContext();

  const enabled = Object.fromEntries(
    PUSH_KINDS.map((kind) => [kind, formData.get(kind) !== null]),
  );

  const user = await getUserById(ctx.userId);
  await setUserPushPrefs(ctx.userId, applyPushPrefs(user?.pushPrefs, enabled));
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

// --- Email identity (PLAN.md §15.1, §15.8 P4) ---------------------------

const contactEmailSchema = z.string().email();

/** Plain bound action, not useActionState-shaped: this section is a short
 *  list of admin-only forms (PLAN.md §15.8 P4), and a bad value here is the
 *  tampered-form case every other hidden-id action in the app already
 *  handles by silently no-op'ing rather than throwing. */
export async function updateContactEmailAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = contactEmailSchema.safeParse(formData.get("contactEmail"));
  if (!parsed.success) return;
  await updateTenantContactEmail(ctx, parsed.data);
  revalidatePath("/settings");
}

const domainSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i);

export async function addEmailDomainAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = domainSchema.safeParse(formData.get("domain"));
  if (!parsed.success) return;

  try {
    const created = await createTenantEmailDomain(ctx, parsed.data.toLowerCase());
    if (created) await scheduleDomainVerification(ctx.tenantId, created.id);
  } catch (err) {
    // Resend rejected the domain (already claimed, malformed, rate-limited).
    // No field to point the error at in this plain-bound-action section
    // (§15.8 P4's own scope, not the useActionState treatment the rest of
    // this page uses) — logged so it's visible in the deploy's logs rather
    // than silently doing nothing.
    console.error("[email] createTenantEmailDomain failed:", err);
  }
  revalidatePath("/settings");
}

export async function retryEmailDomainAction(domainId: string) {
  const ctx = await requireTenantAdmin();
  await refreshTenantEmailDomain(ctx, domainId);
  revalidatePath("/settings");
}

export async function removeEmailDomainAction(domainId: string) {
  const ctx = await requireTenantAdmin();
  await removeTenantEmailDomain(ctx, domainId);
  revalidatePath("/settings");
}

export async function setEmailFromLocalPartAction(domainId: string, formData: FormData) {
  const ctx = await requireTenantAdmin();
  const localPart = String(formData.get("fromLocalPart") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  if (!localPart) return;
  await setTenantEmailFromLocalPart(ctx, domainId, localPart);
  revalidatePath("/settings");
}
