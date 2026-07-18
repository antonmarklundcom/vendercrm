import { getTenantContext } from "@/modules/tenancy/context";
import { getMyTenant } from "@/modules/tenancy/queries";
import { updateTenantSettings, type TenantSettings } from "@/modules/tenancy/settings-actions";
import { Button } from "@/components/ui/button";

export default async function SettingsPage() {
  const ctx = await getTenantContext();
  const tenant = await getMyTenant(ctx);
  if (!tenant) return null;

  const settings = tenant.settings as TenantSettings;
  const canEdit = ctx.role === "admin";

  async function action(formData: FormData) {
    "use server";

    await updateTenantSettings({
      timezone: String(formData.get("timezone") ?? "America/Asuncion"),
      settings: {
        businessHours: String(formData.get("businessHours") ?? "") || undefined,
        brandColor: String(formData.get("brandColor") ?? "") || undefined,
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Configuración</h1>

      <form action={action} className="flex max-w-md flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Nombre del negocio
          <input
            value={tenant.name}
            disabled
            className="rounded-md border border-input bg-muted px-3 py-2 text-muted-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Zona horaria
          <input
            name="timezone"
            defaultValue={tenant.timezone}
            disabled={!canEdit}
            className="rounded-md border border-input bg-background px-3 py-2 disabled:bg-muted disabled:text-muted-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Horario de atención
          <input
            name="businessHours"
            defaultValue={settings?.businessHours ?? ""}
            placeholder="Lun-Vie 8:00-18:00"
            disabled={!canEdit}
            className="rounded-md border border-input bg-background px-3 py-2 disabled:bg-muted disabled:text-muted-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Color de marca
          <input
            type="color"
            name="brandColor"
            defaultValue={settings?.brandColor ?? "#6b7280"}
            disabled={!canEdit}
            className="h-10 w-20 rounded-md border border-input bg-background"
          />
        </label>

        {canEdit ? (
          <Button type="submit" className="self-start">
            Guardar
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Solo un administrador puede editar la configuración.
          </p>
        )}
      </form>
    </div>
  );
}
