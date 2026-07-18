import { notFound } from "next/navigation";
import { getTenantContext } from "@/modules/tenancy/context";
import { getWaAccountById, listTemplates } from "@/modules/whatsapp/queries";
import { syncTemplates } from "@/modules/whatsapp/actions";
import { Button } from "@/components/ui/button";

export default async function WaAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getTenantContext();

  const account = await getWaAccountById(ctx, id);
  if (!account) notFound();

  const templates = await listTemplates(ctx, id);

  async function sync() {
    "use server";
    await syncTemplates(id);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">
          {account.displayNumber ?? account.phoneNumberId}
        </h1>
        <p className="text-sm text-muted-foreground">
          {account.verifiedName} · {account.status}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Plantillas</h2>
          {ctx.role === "admin" && (
            <form action={sync}>
              <Button type="submit" variant="outline" size="sm">
                Sincronizar
              </Button>
            </form>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Idioma</th>
                <th className="px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-4 py-2">{t.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{t.language}</td>
                  <td className="px-4 py-2">{t.status}</td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                    Sin plantillas sincronizadas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
