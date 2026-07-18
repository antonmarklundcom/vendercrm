import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant, type TenantSettings } from "@/modules/tenancy/service";
import { updateSettingsAction } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function SettingsPage() {
  const t = await getTranslations("app");
  const tc = await getTranslations("common");
  const ctx = await requireTenantContext();
  const tenant = await getTenant(ctx.tenantId);
  const settings = (tenant?.settings as TenantSettings | null) ?? {};

  return (
    <div className="max-w-md">
      <h1 className="mb-6 text-xl font-semibold">{t("settings")}</h1>
      <form action={updateSettingsAction} className="flex flex-col gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="timezone">{t("timezone")}</Label>
          <Input
            id="timezone"
            name="timezone"
            defaultValue={tenant?.timezone ?? "America/Asuncion"}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="brandColor">{t("brandColor")}</Label>
          <Input id="brandColor" name="brandColor" defaultValue={settings.brandColor} placeholder="#0ea5e9" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="logoUrl">{t("logoUrl")}</Label>
          <Input id="logoUrl" name="logoUrl" defaultValue={settings.logoUrl} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="businessHoursStart">{t("businessHoursStart")}</Label>
            <Input
              id="businessHoursStart"
              name="businessHoursStart"
              type="time"
              defaultValue={settings.businessHoursStart}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="businessHoursEnd">{t("businessHoursEnd")}</Label>
            <Input
              id="businessHoursEnd"
              name="businessHoursEnd"
              type="time"
              defaultValue={settings.businessHoursEnd}
            />
          </div>
        </div>
        <Button type="submit" className="mt-2 w-fit">
          {tc("save")}
        </Button>
      </form>
    </div>
  );
}
