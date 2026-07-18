import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listContacts } from "@/modules/crm/contacts";
import { createContactAction } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const t = await getTranslations("app");
  const tc = await getTranslations("common");
  const ctx = await requireTenantContext();
  const contacts = await listContacts(ctx, q ? { search: q } : undefined);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t("contacts")}</h1>
          <form className="flex gap-2">
            <Input
              name="q"
              defaultValue={q}
              placeholder={t("search")}
              className="w-56"
            />
            <Button type="submit" variant="outline" size="sm">
              {t("search")}
            </Button>
          </form>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">{tc("name")}</th>
                <th className="px-4 py-2 font-medium">{t("phone")}</th>
                <th className="px-4 py-2 font-medium">{tc("email")}</th>
                <th className="px-4 py-2 font-medium">{t("source")}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link
                      href={`/app/contacts/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.source ?? "—"}</td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    {t("noContacts")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-md">
        <h2 className="mb-4 text-lg font-semibold">{t("newContact")}</h2>
        <form action={createContactAction} className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="name">{tc("name")}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input id="phone" name="phone" placeholder="0981 123 456" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">{tc("email")}</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <Button type="submit" className="mt-2 w-fit">
            {tc("create")}
          </Button>
        </form>
      </section>
    </div>
  );
}
