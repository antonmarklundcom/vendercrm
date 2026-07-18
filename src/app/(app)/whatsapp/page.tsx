import Link from "next/link";
import { getTenantContext } from "@/modules/tenancy/context";
import { listWaAccounts } from "@/modules/whatsapp/queries";
import { connectWhatsAppManual } from "@/modules/whatsapp/actions";
import { Button } from "@/components/ui/button";

export default async function WhatsAppPage() {
  const ctx = await getTenantContext();
  const accounts = await listWaAccounts(ctx);
  const canEdit = ctx.role === "admin";

  async function action(formData: FormData) {
    "use server";

    await connectWhatsAppManual({
      wabaId: String(formData.get("wabaId") ?? ""),
      phoneNumberId: String(formData.get("phoneNumberId") ?? ""),
      accessToken: String(formData.get("accessToken") ?? ""),
      displayNumber: String(formData.get("displayNumber") ?? "") || undefined,
      verifiedName: String(formData.get("verifiedName") ?? "") || undefined,
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">WhatsApp</h1>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Conectado vía</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link href={`/whatsapp/${a.id}`} className="hover:underline">
                    {a.displayNumber ?? a.phoneNumberId}
                  </Link>
                </td>
                <td className="px-4 py-2">{a.status}</td>
                <td className="px-4 py-2 text-muted-foreground">{a.connectedVia}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  Ningún número conectado todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form action={action} className="flex max-w-md flex-col gap-4">
          <h2 className="text-lg font-medium">Conectar número (manual)</h2>
          <p className="text-sm text-muted-foreground">
            Generá un token de sistema en Meta Business Manager y pegalo acá. La
            conexión con firma automática (embedded signup) llega más adelante.
          </p>

          <label className="flex flex-col gap-1 text-sm">
            WABA ID
            <input
              name="wabaId"
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Phone Number ID
            <input
              name="phoneNumberId"
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Número (para mostrar)
            <input
              name="displayNumber"
              placeholder="+595981234567"
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Nombre verificado
            <input
              name="verifiedName"
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Token de acceso (system user)
            <input
              type="password"
              name="accessToken"
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>

          <Button type="submit">Conectar</Button>
        </form>
      )}
    </div>
  );
}
