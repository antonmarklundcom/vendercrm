import { listRecentFailedWebhookEvents, listWaAccountsAcrossTenants } from "@/modules/whatsapp/admin-queries";

export default async function SuperadminWhatsAppPage() {
  const [accounts, failedEvents] = await Promise.all([
    listWaAccountsAcrossTenants(),
    listRecentFailedWebhookEvents(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">WhatsApp — Salud de la plataforma</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Números conectados</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Número</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Calidad</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-2">{a.tenantName}</td>
                  <td className="px-4 py-2">{a.displayNumber ?? a.phoneNumberId}</td>
                  <td className="px-4 py-2">{a.status}</td>
                  <td className="px-4 py-2 text-muted-foreground">{a.qualityRating ?? "—"}</td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    Ningún número conectado todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Webhooks fallidos recientes</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Phone Number ID</th>
                <th className="px-4 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {failedEvents.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-4 py-2">{e.phoneNumberId ?? "—"}</td>
                  <td className="px-4 py-2 text-destructive">{e.error}</td>
                </tr>
              ))}
              {failedEvents.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                    Sin fallos recientes.
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
