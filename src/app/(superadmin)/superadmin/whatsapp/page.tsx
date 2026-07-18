import { getTranslations } from "next-intl/server";
import { listAllAccounts, listFailedWebhookEvents } from "@/modules/whatsapp";

// Platform WhatsApp health (PLAN.md §6.5): connected numbers and recent webhook
// failures across all tenants. Read-only superadmin view.
export default async function WhatsAppHealthPage() {
  const t = await getTranslations("superadmin");
  const [accounts, failures] = await Promise.all([
    listAllAccounts(),
    listFailedWebhookEvents(50),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("waHealth")}</h1>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">{t("waNumber")}</th>
                <th className="px-4 py-2 font-medium">Phone Number ID</th>
                <th className="px-4 py-2 font-medium">{t("status")}</th>
                <th className="px-4 py-2 font-medium">{t("waQuality")}</th>
                <th className="px-4 py-2 font-medium">{t("waConnectedVia")}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-4 py-2">{a.displayNumber ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{a.phoneNumberId}</td>
                  <td className="px-4 py-2">{a.status}</td>
                  <td className="px-4 py-2">{a.qualityRating ?? "—"}</td>
                  <td className="px-4 py-2">{a.connectedVia}</td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("waFailures")}</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Phone Number ID</th>
                <th className="px-4 py-2 font-medium">Error</th>
                <th className="px-4 py-2 font-medium">{t("expiresAt")}</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-4 py-2 text-muted-foreground">{e.phoneNumberId ?? "—"}</td>
                  <td className="px-4 py-2">{e.error ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.createdAt.toLocaleString("es-PY")}
                  </td>
                </tr>
              ))}
              {failures.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                    —
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
