import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listForms } from "@/modules/forms/service";
import { getTenant } from "@/modules/tenancy/service";
import { env } from "@/lib/config/env";
import { createFormAction, setFormActiveAction } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function FormsPage() {
  const t = await getTranslations("app");
  const tc = await getTranslations("common");
  const ctx = await requireTenantContext();
  const [forms, tenant] = await Promise.all([
    listForms(ctx),
    getTenant(ctx.tenantId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("forms")}</h1>
        <div className="flex flex-col gap-2">
          {forms.map((f) => {
            const url = `${env.APP_URL}/f/${tenant?.slug}/${f.slug}`;
            return (
              <div
                key={f.id}
                className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{f.name}</div>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {url}
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <span className={f.isActive ? "text-green-600" : "text-muted-foreground"}>
                    {f.isActive ? t("active") : t("inactive")}
                  </span>
                  <form
                    action={async () => {
                      "use server";
                      await setFormActiveAction(f.id, !f.isActive);
                    }}
                  >
                    <Button type="submit" variant="ghost" size="sm">
                      {f.isActive ? t("disable") : t("enable")}
                    </Button>
                  </form>
                </div>
              </div>
            );
          })}
          {forms.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("noForms")}</p>
          )}
        </div>
      </section>

      <section className="max-w-md">
        <h2 className="mb-4 text-lg font-semibold">{t("newForm")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Se crea con campos Nombre, Teléfono y Correo por defecto.
        </p>
        <form action={createFormAction} className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="name">{t("formName")}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="slug">{"slug"}</Label>
            <Input id="slug" name="slug" required pattern="[a-z0-9-]+" placeholder="contacto" />
          </div>
          <Button type="submit" className="mt-2 w-fit">
            {tc("create")}
          </Button>
        </form>
      </section>
    </div>
  );
}
