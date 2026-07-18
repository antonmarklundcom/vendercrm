import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/modules/tenancy/context";
import { getMyTenant } from "@/modules/tenancy/queries";
import { listForms } from "@/modules/forms/queries";

export default async function FormsPage() {
  const ctx = await getTenantContext();
  const [formsList, tenant] = await Promise.all([listForms(ctx), getMyTenant(ctx)]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Formularios</h1>
        <Button asChild>
          <Link href="/forms/new">Nuevo formulario</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Enlace público</th>
              <th className="px-4 py-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {formsList.map((f) => (
              <tr key={f.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link href={`/forms/${f.id}`} className="hover:underline">
                    {f.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  /f/{tenant?.slug}/{f.slug}
                </td>
                <td className="px-4 py-2">{f.isActive ? "Sí" : "No"}</td>
              </tr>
            ))}
            {formsList.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  Sin formularios todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
