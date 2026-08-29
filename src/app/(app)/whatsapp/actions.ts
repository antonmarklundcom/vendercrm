"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { connectAccountManually } from "@/modules/whatsapp/accounts";
import { syncTemplates } from "@/modules/whatsapp/templates";
import { submitBookingTemplates } from "@/modules/booking/notification-registration";

const connectSchema = z.object({
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  displayNumber: z.string().optional().or(z.literal("")),
  accessToken: z.string().min(1),
});

// useActionState-shaped (PLAN.md §10 1R #6): a missing field comes back
// inline next to the offending input instead of throwing to Next's error
// page.
export type ConnectField = "wabaId" | "phoneNumberId" | "accessToken";

export type ConnectFormState = {
  error: string | null;
  field: ConnectField | null;
  values: Record<string, string>;
};

const CONNECT_FIELD_ERRORS: Record<ConnectField, string> = {
  wabaId: "wabaIdRequired",
  phoneNumberId: "phoneNumberIdRequired",
  accessToken: "accessTokenRequired",
};

export async function connectAccountAction(
  _prevState: ConnectFormState,
  formData: FormData,
): Promise<ConnectFormState> {
  const ctx = await requireTenantAdmin();
  // accessToken is dropped rather than echoed: this state is serialized back
  // to the browser, and the token is a per-tenant secret (§3.4) that only
  // ever belongs in wa_accounts encrypted. The form deliberately has no
  // defaultValue for it either — a secret is worth retyping.
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[0] !== "accessToken",
    ),
  );

  const parsed = connectSchema.safeParse({
    wabaId: formData.get("wabaId"),
    phoneNumberId: formData.get("phoneNumberId"),
    displayNumber: formData.get("displayNumber") || undefined,
    accessToken: formData.get("accessToken"),
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (typeof field === "string" && field in CONNECT_FIELD_ERRORS) {
      const key = field as ConnectField;
      return { error: CONNECT_FIELD_ERRORS[key], field: key, values };
    }
    return { error: "unknown", field: null, values };
  }

  try {
    await connectAccountManually(ctx, parsed.data);
  } catch {
    return { error: "unknown", field: null, values };
  }

  revalidatePath("/whatsapp");
  return { error: null, field: null, values: {} };
}

// Manual "sync" button (§6.4). Runs inline rather than through the
// recurring job so the admin sees the result immediately — and so it can't
// seed a second nightly chain alongside the one connect already started.
export async function syncTemplatesAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z.string().min(1).safeParse(formData.get("accountId"));
  if (!parsed.success) return;
  await syncTemplates(ctx, parsed.data);
  revalidatePath("/whatsapp");
}

/**
 * Submits the booking notification templates to this tenant's own WABA
 * (plan-booking.md §7). A button rather than an automatic step on connect:
 * it creates artifacts in someone else's Meta account and starts a review
 * cycle, which is a thing an admin should choose to do — and pressing it
 * twice is harmless, since an existing template comes back as "exists".
 */
export async function submitBookingTemplatesAction() {
  const ctx = await requireTenantAdmin();
  await submitBookingTemplates(ctx);
  revalidatePath("/whatsapp");
}
