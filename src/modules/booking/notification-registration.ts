import type { TenantContext } from "@/modules/tenancy/context";
import { getPrimaryAccount } from "@/modules/whatsapp/accounts";
import {
  listTemplates,
  submitTemplate,
  syncTemplates,
  type SubmitTemplateOutcome,
} from "@/modules/whatsapp/templates";
import { BOOKING_NOTIFICATION_KINDS, type BookingNotificationKind } from "./notification-chain";
import {
  BOOKING_TEMPLATES,
  BOOKING_TEMPLATE_LANGUAGE,
  templateSubmissionPayload,
} from "./notification-templates";

// Getting this tenant's booking templates in front of Meta.
//
// Until they are APPROVED the chain falls back to email, so nothing is
// broken while review runs — but a tenant with no email addresses on file is
// a tenant whose customers hear nothing, which is why this is a button in
// the UI and an item on the human checklist (plan-booking.md §7) rather than
// something the platform can quietly do for everyone.

export type BookingTemplateStatus = {
  kind: BookingNotificationKind;
  name: string;
  /** Meta's status, or `MISSING` when the template was never submitted. */
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "MISSING";
};

export async function bookingTemplateStatuses(
  ctx: TenantContext,
): Promise<BookingTemplateStatus[]> {
  const account = await getPrimaryAccount(ctx);
  const rows = account ? await listTemplates(ctx, account.id) : [];
  const byName = new Map(
    rows
      .filter((row) => row.language === BOOKING_TEMPLATE_LANGUAGE)
      .map((row) => [row.name, row.status]),
  );

  return BOOKING_NOTIFICATION_KINDS.map((kind) => {
    const name = BOOKING_TEMPLATES[kind].name;
    return { kind, name, status: byName.get(name) ?? "MISSING" };
  });
}

/**
 * Submits every booking template that isn't already at Meta, then re-syncs
 * so the local statuses reflect what was just created. Returns one outcome
 * per template — a partial success is the normal case (some already exist),
 * and the caller shows the list rather than a single "listo".
 */
export async function submitBookingTemplates(
  ctx: TenantContext,
): Promise<{ outcomes: SubmitTemplateOutcome[] } | { error: "no_account" }> {
  const account = await getPrimaryAccount(ctx);
  if (!account) return { error: "no_account" };

  const outcomes: SubmitTemplateOutcome[] = [];
  for (const kind of BOOKING_NOTIFICATION_KINDS) {
    const payload = templateSubmissionPayload(kind);
    try {
      outcomes.push(await submitTemplate(ctx, account.id, payload));
    } catch (err) {
      outcomes.push({
        status: "failed",
        name: payload.name,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      });
    }
  }

  // Best effort: the submissions are the point, and a sync that fails leaves
  // the nightly job to catch up.
  try {
    await syncTemplates(ctx, account.id);
  } catch {
    /* statuses refresh on the next sync */
  }

  return { outcomes };
}
