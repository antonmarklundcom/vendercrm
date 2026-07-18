import Link from "next/link";
import { Button } from "@/components/ui/button";
import { listTenants } from "@/modules/tenancy/queries";

export default async function TenantsPage() {
  const rows = await listTenants();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <Button asChild>
          <Link href="/superadmin/tenants/new">Nuevo tenant</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Slug</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Creado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link href={`/superadmin/tenants/${t.id}`} className="hover:underline">
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{t.slug}</td>
                <td className="px-4 py-2">{t.status}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {t.createdAt.toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Todavía no hay tenants.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
