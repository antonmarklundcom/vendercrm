import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/service";

export default async function DashboardPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app");
  const tenant = await getTenant(ctx.tenantId);

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">
        {t("welcome")}, {tenant?.name}
      </h1>
      <p className="text-muted-foreground">
        {ctx.role === "admin" ? "Administrador" : "Agente"}
      </p>
    </div>
  );
}
