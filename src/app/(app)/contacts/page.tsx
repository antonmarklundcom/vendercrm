import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/modules/tenancy/context";
import { listContacts, listTags } from "@/modules/crm/queries";
import { createTag } from "@/modules/crm/actions";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string }>;
}) {
  const { q, tag } = await searchParams;
  const ctx = await getTenantContext();

  const [contactsList, tagsList] = await Promise.all([
    listContacts(ctx, { search: q, tagId: tag }),
    listTags(ctx),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contactos</h1>
        <Button asChild>
          <Link href="/contacts/new">Nuevo contacto</Link>
        </Button>
      </div>

      <form className="flex gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, teléfono o email"
          className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <select
          name="tag"
          defaultValue={tag ?? ""}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Todas las etiquetas</option>
          {tagsList.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      <form
        action={async (formData: FormData) => {
          "use server";
          const name = String(formData.get("tagName") ?? "").trim();
          if (name) await createTag({ name });
        }}
        className="flex items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-sm">
          Nueva etiqueta
          <input
            name="tagName"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Crear etiqueta
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Teléfono</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Origen</th>
            </tr>
          </thead>
          <tbody>
            {contactsList.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link href={`/contacts/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{c.phone}</td>
                <td className="px-4 py-2 text-muted-foreground">{c.email}</td>
                <td className="px-4 py-2 text-muted-foreground">{c.source}</td>
              </tr>
            ))}
            {contactsList.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Sin contactos todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
