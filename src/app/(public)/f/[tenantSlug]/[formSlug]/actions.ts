"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { submitForm } from "@/modules/forms/submissions";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";

export async function submitFormAction(
  tenantSlug: string,
  formSlug: string,
  formData: FormData,
) {
  // Honeypot (PLAN.md §5): a hidden field bots fill in and humans never see.
  if (formData.get("_hp")) {
    return;
  }

  const data: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "_hp") continue;
    data[key] = String(value);
  }

  const headersList = await headers();

  // Public and unauthenticated, so it needs a ceiling of its own — the
  // honeypot above only stops naive bots (§10 1H).
  if (!rateLimit(clientKey(headersList, "form"), 10, 60_000).allowed) {
    redirect(`/f/${tenantSlug}/${formSlug}/gracias`);
  }

  let redirectTo = `/f/${tenantSlug}/${formSlug}/gracias`;
  try {
    const result = await submitForm(tenantSlug, formSlug, {
      data,
      ipAddress: headersList.get("x-forwarded-for") ?? undefined,
      userAgent: headersList.get("user-agent") ?? undefined,
    });
    redirectTo = result.redirectUrl || redirectTo;
  } catch (error) {
    // The visitor filled in a form and pressed send; a CRM-side failure is
    // not something they can act on. Log it for the operator and still show
    // the thank-you page rather than an error screen.
    reportError(error, { scope: "form.submit", tenantSlug, formSlug });
  }

  redirect(redirectTo);
}
