import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { BusinessHours, TenantSettings } from "@/modules/tenancy/settings";
import { Button } from "@/components/ui/button";
import { updateBrandingAction, updateBusinessHoursAction, updateTimezoneAction } from "./actions";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export default async function SettingsPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.settings");
  const tc = await getTranslations("common");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
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

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("brandingTitle")}</h2>
        <form action={updateBrandingAction} className="flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("logoUrl")}
            <input
              name="logoUrl"
              type="url"
              defaultValue={settings.branding?.logoUrl ?? ""}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("primaryColor")}
            <input
              name="primaryColor"
              type="color"
              defaultValue={settings.branding?.primaryColor ?? "#000000"}
              className="h-10 w-20 rounded-md border"
            />
          </label>
          <Button type="submit">{tc("save")}</Button>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("timezoneTitle")}</h2>
        <form action={updateTimezoneAction} className="flex max-w-sm gap-2">
          <input
            name="timezone"
            defaultValue={tenant?.timezone ?? "America/Asuncion"}
            className="flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <Button type="submit" variant="outline">
            {tc("save")}
          </Button>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("businessHoursTitle")}</h2>
        <form action={updateBusinessHoursAction} className="flex max-w-md flex-col gap-3">
          {DAYS.map((day) => (
            <div key={day} className="flex items-center gap-3 text-sm">
              <label className="flex w-32 items-center gap-2">
                <input
                  type="checkbox"
                  name={`${day}_enabled`}
                  defaultChecked={!!businessHours[day]}
                />
                {t(`days.${day}` as "days.mon")}
              </label>
              <input
                type="time"
                name={`${day}_start`}
                defaultValue={businessHours[day]?.start ?? "08:00"}
                className="rounded-md border px-2 py-1"
              />
              <span>—</span>
              <input
                type="time"
                name={`${day}_end`}
                defaultValue={businessHours[day]?.end ?? "18:00"}
                className="rounded-md border px-2 py-1"
              />
            </div>
          ))}
          <Button type="submit" className="mt-2 w-fit">
            {tc("save")}
          </Button>
        </form>
      </section>
    </div>
  );
}
