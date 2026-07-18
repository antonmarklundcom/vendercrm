import { createTenant } from "@/modules/tenancy/tenant-actions";
import { Button } from "@/components/ui/button";

export default function NewTenantPage() {
  async function action(formData: FormData) {
    "use server";

    await createTenant({
      name: String(formData.get("name") ?? ""),
      adminName: String(formData.get("adminName") ?? ""),
      adminEmail: String(formData.get("adminEmail") ?? ""),
      adminPassword: String(formData.get("adminPassword") ?? ""),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nuevo tenant</h1>

      <form action={action} className="flex max-w-md flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Nombre del negocio
          <input
            name="name"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <div className="mt-2 border-t border-border pt-4 text-sm text-muted-foreground">
          Cuenta de administrador inicial del tenant
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Nombre
          <input
            name="adminName"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            name="adminEmail"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Contraseña temporal
          <input
            type="password"
            name="adminPassword"
            required
            minLength={8}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <Button type="submit">Crear tenant</Button>
      </form>
    </div>
  );
}
