import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listTenants } from "@/modules/tenancy/service";
import { createTenantAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function TenantsPage() {
  const t = await getTranslations("superadmin");
  const tc = await getTranslations("common");
  const tenants = await listTenants();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("tenants")}</h1>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">{t("tenantName")}</th>
                <th className="px-4 py-2 font-medium">{t("slug")}</th>
                <th className="px-4 py-2 font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link
                      href={`/superadmin/tenants/${tenant.id}`}
                      className="font-medium hover:underline"
                    >
                      {tenant.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{tenant.slug}</td>
                  <td className="px-4 py-2">{t(tenant.status)}</td>
                </tr>
              ))}
              {tenants.length === 0 && (
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

      <section className="max-w-md">
        <h2 className="mb-4 text-lg font-semibold">{t("newTenant")}</h2>
        <form action={createTenantAction} className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="name">{t("tenantName")}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="slug">{t("slug")}</Label>
            <Input id="slug" name="slug" required pattern="[a-z0-9-]+" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adminName">{t("adminName")}</Label>
            <Input id="adminName" name="adminName" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adminEmail">{t("adminEmail")}</Label>
            <Input id="adminEmail" name="adminEmail" type="email" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adminPassword">{t("adminPassword")}</Label>
            <Input
              id="adminPassword"
              name="adminPassword"
              type="password"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="mt-2 w-fit">
            {tc("create")}
          </Button>
        </form>
      </section>
    </div>
  );
}
