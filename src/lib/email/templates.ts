import { GRACE_PERIOD_DAYS } from "@/modules/tenancy/subscriptions";
import { getTranslator } from "@/lib/i18n/translator";
import { formatDate } from "@/lib/i18n/format";

// Minimal inline-styled HTML — no build step, no MJML, and email clients
// strip most CSS anyway. Kept deliberately plain (one accent color, system
// font stack) rather than matching per-tenant branding: these are platform
// and account-security emails (invite, reset, expiry), not customer-facing
// documents like the quote PDF, which already carries tenant branding.
//
// The copy lives in the messages files like everything else (PLAN.md §13 H5
// #4); only the markup lives here. Every template takes the recipient's
// locale, which callers resolve from the tenant (or the user, where one is
// already known) — never from whoever happened to trigger the send.

type Email = { subject: string; html: string };

function layout(bodyHtml: string, locale: string): string {
  return `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      ${bodyHtml}
      <p style="margin-top:32px;font-size:12px;color:#71717a;">clientes.com.py</p>
    </div>
  </body>
</html>`;
}

function heading(text: string): string {
  return `<h1 style="font-size:18px;margin:0 0 8px;">${text}</h1>`;
}

function paragraph(html: string): string {
  return `<p style="font-size:14px;line-height:1.5;color:#3f3f46;">${html}</p>`;
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;margin-top:16px;padding:12px 20px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${label}</a>`;
}

export async function invitationEmail(input: {
  tenantName: string;
  inviterName: string;
  acceptUrl: string;
  locale?: string | null;
}): Promise<Email> {
  const t = await getTranslator(input.locale, "email.invitation");
  return {
    subject: t("subject", { inviter: input.inviterName, tenant: input.tenantName }),
    html: layout(
      `
      ${heading(t("title", { tenant: input.tenantName }))}
      ${paragraph(t("body", { inviter: input.inviterName }))}
      ${button(input.acceptUrl, t("cta"))}
    `,
      input.locale ?? "es",
    ),
  };
}

export async function passwordResetEmail(input: {
  resetUrl: string;
  locale?: string | null;
}): Promise<Email> {
  const t = await getTranslator(input.locale, "email.passwordReset");
  return {
    subject: t("subject"),
    html: layout(
      `
      ${heading(t("title"))}
      ${paragraph(t("body"))}
      ${button(input.resetUrl, t("cta"))}
    `,
      input.locale ?? "es",
    ),
  };
}

export async function subscriptionExpiryWarningEmail(input: {
  tenantName: string;
  expiresAt: Date;
  daysRemaining: number;
  locale?: string | null;
}): Promise<Email> {
  const t = await getTranslator(input.locale, "email.subscriptionExpiry");
  const date = formatDate(input.expiresAt, input.locale ?? "es", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return {
    subject: t("subject", { days: input.daysRemaining }),
    html: layout(
      `
      ${heading(t("title"))}
      ${paragraph(t("body", { tenant: input.tenantName, date, grace: GRACE_PERIOD_DAYS }))}
    `,
      input.locale ?? "es",
    ),
  };
}

/**
 * Per-site ingest alert (PLAN.md §5.2.5). Deliberately says what broke, when,
 * and where to look — and nothing else: no submitted data, no API key, no
 * webhook token. The reason arrives as a short code from
 * modules/sites/health.ts and is resolved through the messages file.
 */
export async function siteIngestAlertEmail(input: {
  siteName: string;
  kind: "failing" | "stale";
  reason?: string | null;
  status?: number | null;
  lastSuccessAt?: Date | null;
  daysSilent?: number;
  sitesUrl: string;
  locale?: string | null;
}): Promise<Email> {
  const locale = input.locale ?? "es";
  const t = await getTranslator(locale, "email.siteIngestAlert");

  const lastLead = input.lastSuccessAt
    ? t("lastLead", {
        date: formatDate(input.lastSuccessAt, locale, {
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        }),
      })
    : t("noLeadYet");

  if (input.kind === "stale") {
    return {
      subject: t("staleSubject", { site: input.siteName, days: input.daysSilent ?? 0 }),
      html: layout(
        `
        ${heading(t("staleTitle", { site: input.siteName }))}
        ${paragraph(t("staleBody", { days: input.daysSilent ?? 0, lastLead }))}
        ${paragraph(`<a href="${input.sitesUrl}">${t("staleLink")}</a>`)}
      `,
        locale,
      ),
    };
  }

  const reasonKey = input.reason ?? "unknown";
  const reason = t.has(`reasons.${reasonKey}`) ? t(`reasons.${reasonKey}`) : t("reasons.unknown");

  return {
    subject: t("failingSubject", { site: input.siteName }),
    html: layout(
      `
      ${heading(t("failingTitle", { site: input.siteName }))}
      ${paragraph(t("failingBody", { status: input.status ?? 0, reason }))}
      ${paragraph(lastLead)}
      ${paragraph(`<a href="${input.sitesUrl}">${t("failingLink")}</a>`)}
    `,
      locale,
    ),
  };
}


/**
 * Daily "what's due" digest (PLAN.md §13 H6). Deliberately a list of the
 * recipient's own tasks with a link each, and nothing else: the email is a
 * nudge back into the CRM, not a place to work from.
 */
export async function taskRemindersEmail(input: {
  userName: string;
  items: Array<{
    title: string;
    dueAt: Date;
    overdue: boolean;
    contactName: string | null;
    url: string;
  }>;
  /** The day's appointments, when there are any — the agenda half of the
   * same mail (modules/crm/task-reminders.ts). */
  appointments?: Array<{
    title: string;
    startsAt: Date;
    allDay: boolean;
    location: string | null;
    contactName: string | null;
    url: string;
  }>;
  tasksUrl: string;
  locale?: string | null;
}): Promise<Email> {
  const locale = input.locale ?? "es";
  const t = await getTranslator(locale, "email.taskReminders");

  const overdueCount = input.items.filter((item) => item.overdue).length;
  const appointments = input.appointments ?? [];

  const rows = input.items
    .map((item) => {
      const when = formatDate(item.dueAt, locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const who = item.contactName ? ` · ${item.contactName}` : "";
      const flag = item.overdue ? ` · <strong>${t("overdue")}</strong>` : "";
      return `<li style="margin-bottom:8px;"><a href="${item.url}">${item.title}</a><br /><span style="color:#71717a;">${when}${who}${flag}</span></li>`;
    })
    .join("");

  const appointmentRows = appointments
    .map((appointment) => {
      const when = appointment.allDay
        ? t("allDay")
        : formatDate(appointment.startsAt, locale, {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
      const where = appointment.location ? ` · ${appointment.location}` : "";
      const who = appointment.contactName ? ` · ${appointment.contactName}` : "";
      return `<li style="margin-bottom:8px;"><a href="${appointment.url}">${appointment.title}</a><br /><span style="color:#71717a;">${when}${who}${where}</span></li>`;
    })
    .join("");

  // Whichever half is empty is left out entirely: a heading over nothing
  // reads as a bug, and both halves are optional by construction (the sender
  // skips a user only when both are empty).
  const taskSection =
    input.items.length > 0
      ? `
      ${paragraph(t("body", { count: input.items.length, overdue: overdueCount }))}
      <ul style="font-size:14px;line-height:1.5;color:#3f3f46;padding-left:18px;">${rows}</ul>`
      : "";

  const appointmentSection =
    appointments.length > 0
      ? `
      ${paragraph(t("appointmentsBody", { count: appointments.length }))}
      <ul style="font-size:14px;line-height:1.5;color:#3f3f46;padding-left:18px;">${appointmentRows}</ul>`
      : "";

  return {
    subject:
      input.items.length > 0
        ? t("subject", { count: input.items.length })
        : t("appointmentsSubject", { count: appointments.length }),
    html: layout(
      `
      ${heading(t("title", { name: input.userName }))}
      ${taskSection}
      ${appointmentSection}
      ${button(input.tasksUrl, t("cta"))}
    `,
      locale,
    ),
  };
}

/**
 * The Monday weekly briefing (PLAN.md §15.3 L2, §17.2 P14) — the same
 * narrative and recommendations the dashboard card shows, mailed to every
 * tenant admin.
 */
export async function weeklyBriefingEmail(input: {
  businessName: string;
  summary: string;
  recommendations: string[];
  briefingUrl: string;
  locale?: string | null;
}): Promise<Email> {
  const locale = input.locale ?? "es";
  const t = await getTranslator(locale, "email.weeklyBriefing");

  const items = input.recommendations
    .map((line) => `<li style="margin-bottom:8px;">${line}</li>`)
    .join("");

  return {
    subject: t("subject", { business: input.businessName }),
    html: layout(
      `
      ${heading(t("title"))}
      ${paragraph(input.summary)}
      <ul style="font-size:14px;line-height:1.5;color:#3f3f46;padding-left:18px;">${items}</ul>
      ${button(input.briefingUrl, t("cta"))}
    `,
      locale,
    ),
  };
}
