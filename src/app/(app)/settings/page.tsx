import { getTranslations, getLocale } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { BusinessHours, TenantSettings } from "@/modules/tenancy/settings";
import { PageHeader } from "@/components/page-header";
import { AuditTable } from "@/components/audit-table";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getUserById } from "@/modules/tenancy/users";
import { TaskReminderToggle } from "./TaskReminderToggle";
import { listAuditLogForTenant } from "@/modules/tenancy/audit";
import { contactsFeedUrl } from "@/modules/crm/feed-url";
import { isAiConfigured } from "@/lib/ai";
import { resolveAiConfig } from "@/modules/ai/config";
import { monthlyTokenUsage } from "@/modules/ai/replies";
import { COUNTRY_CODES, DEFAULT_COUNTRY } from "@/lib/phone";
import { SheetsFeed, type SheetsLabels } from "./SheetsFeed";
import { getConnection, isGcalConfigured } from "@/modules/calendar/gcal";
import { connectGcalAction, disconnectGcalAction } from "./actions";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/i18n/format";
import {
  BrandingForm,
  BusinessHoursForm,
  TimezoneForm,
  DefaultCountryForm,
  ReviewLinkForm,
  AiSettingsForm,
} from "./SettingsForms";

export default async function SettingsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.settings");
  const ta = await getTranslations("audit");
  const locale = await getLocale();

  // Language is the one setting that isn't tenant configuration: it's the
  // user's own, so an agent gets this page for that alone rather than the
  // bare "admins only" line they used to hit (PLAN.md §13 H5 #2).
  if (ctx.role !== "admin") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title={t("language.title")} description={t("language.intro")} />
        <LanguageSwitcher />
        <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>
      </div>
    );
  }

  const tenant = await getTenant(ctx.tenantId);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const businessHours: BusinessHours =
    settings.businessHours ?? {
      mon: null,
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: null,
      sun: null,
    };

  const [auditEntries, currentUser, gcalConnection] = await Promise.all([
    listAuditLogForTenant(ctx.tenantId),
    getUserById(ctx.userId),
    getConnection(ctx, ctx.userId),
  ]);
  const gcalConfigured = isGcalConfigured();

  const ai = resolveAiConfig(tenant?.name ?? "", settings.ai);
  const aiUsage = await monthlyTokenUsage(ctx);
  const aiDriverConfigured = isAiConfigured();

  const sheetsLabels: SheetsLabels = {
    formulaLabel: t("sheetsFormula"),
    copy: t("sheetsCopy"),
    copied: t("sheetsCopied"),
    generate: t("sheetsGenerate"),
    regenerate: t("sheetsRegenerate"),
    regenerateWarning: t("sheetsRegenerateWarning"),
    steps: (["generate", "paste", "refresh"] as const).map((key) =>
      t(`sheetsSteps.${key}`),
    ),
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro")} />

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("brandingTitle")}</h2>
        <BrandingForm
          logoUrl={settings.branding?.logoUrl ?? ""}
          primaryColor={settings.branding?.primaryColor ?? "#000000"}
        />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("timezoneTitle")}</h2>
        <TimezoneForm timezone={tenant?.timezone ?? "America/Asuncion"} />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("defaultCountryTitle")}</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
          {t("defaultCountryIntro")}
        </p>
        <DefaultCountryForm
          defaultCountry={settings.defaultCountry ?? DEFAULT_COUNTRY}
          countryCodes={COUNTRY_CODES}
        />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("reviewLinkTitle")}</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("reviewLinkIntro")}</p>
        <ReviewLinkForm reviewLink={settings.reviewLink ?? ""} />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("businessHoursTitle")}</h2>
        <BusinessHoursForm businessHours={businessHours} />
      </section>

      {/* AI auto-reply (PLAN.md §10 1O). The two switches that carry real
          risk — "activar" and "borrador vs. envío automático" — sit at the
          top of the form, above the free-text context that shapes what the
          model says. */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">{t("aiTitle")}</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("aiIntro")}</p>

        {!aiDriverConfigured && (
          <p className="mb-4 max-w-2xl rounded-md border bg-warning-surface px-3 py-2 text-sm text-warning">
            {t("aiNotConfigured")}
          </p>
        )}

        <AiSettingsForm
          enabled={ai.enabled}
          mode={ai.mode}
          businessName={settings.ai?.businessName ?? ""}
          businessNamePlaceholder={tenant?.name ?? ""}
          about={settings.ai?.about ?? ""}
          tone={settings.ai?.tone ?? ""}
          hours={settings.ai?.hours ?? ""}
          neverPromise={settings.ai?.neverPromise ?? ""}
          maxRepliesPerConversationPerDay={ai.maxRepliesPerConversationPerDay}
          maxRepliesPerTenantPerDay={ai.maxRepliesPerTenantPerDay}
          handoffKeyword={ai.handoffKeyword}
          bookingEnabled={ai.bookingEnabled}
        />

        <div className="mt-6 max-w-2xl rounded-md border p-3 text-sm">
          <h3 className="mb-1 font-medium">{t("aiUsageTitle")}</h3>
          <p className="text-muted-foreground">
            {t("aiUsageBody", {
              replies: aiUsage.replies,
              prompt: aiUsage.promptTokens,
              completion: aiUsage.completionTokens,
              total: aiUsage.promptTokens + aiUsage.completionTokens,
            })}
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t("sheetsTitle")}</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("sheetsIntro")}</p>
        <SheetsFeed
          currentUrl={
            settings.exports?.contactsToken
              ? contactsFeedUrl(settings.exports.contactsToken)
              : null
          }
          labels={sheetsLabels}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t("taskReminders.title")}</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
          {t("taskReminders.intro")}
        </p>
        <TaskReminderToggle
          enabled={currentUser?.taskReminders ?? true}
          labels={{
            on: t("taskReminders.on"),
            off: t("taskReminders.off"),
            enable: t("taskReminders.enable"),
            disable: t("taskReminders.disable"),
          }}
        />
      </section>

      {/* Google Calendar busy-read (plan-booking.md §5.4). Per staff member,
          not per tenant: it is this person's own calendar, and the answer it
          gives is "when is *she* busy". */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">{t("gcal.title")}</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("gcal.intro")}</p>
        {!gcalConfigured ? (
          <p className="text-sm text-muted-foreground">{t("gcal.notConfigured")}</p>
        ) : gcalConnection ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              {t("gcal.connected")}
              {gcalConnection.lastBusyReadAt
                ? ` · ${t("gcal.lastRead", {
                    when: formatDateTime(gcalConnection.lastBusyReadAt, locale, tenant?.timezone),
                  })}`
                : ""}
            </span>
            {/* A revoked or erroring connection is silent otherwise: slots
                just quietly stop excluding the calendar. */}
            {gcalConnection.status !== "connected" ? (
              <span className="text-destructive">
                {gcalConnection.status === "revoked"
                  ? t("gcal.status.revoked")
                  : t("gcal.status.error")}
              </span>
            ) : null}
            <form action={disconnectGcalAction}>
              <Button type="submit" size="sm" variant="outline">
                {t("gcal.disconnect")}
              </Button>
            </form>
          </div>
        ) : (
          <form action={connectGcalAction}>
            <Button type="submit" size="sm" variant="outline">
              {t("gcal.connect")}
            </Button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t("language.title")}</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("language.intro")}</p>
        <LanguageSwitcher />
      </section>

      {/* Own tenant only — the cross-tenant feed lives in the superadmin
          console. This is where an admin answers "who deactivated her?". */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">{ta("title")}</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{ta("intro")}</p>
        <AuditTable entries={auditEntries} />
      </section>
    </div>
  );
}
