import { notFound } from "next/navigation";
import { getTenantContext } from "@/modules/tenancy/context";
import { getMyTenant } from "@/modules/tenancy/queries";
import { getFormById, getFormSubmissions } from "@/modules/forms/queries";
import { setFormActive, updateFormFields } from "@/modules/forms/actions";
import { FormFieldsEditor } from "@/components/form-fields-editor";
import { Button } from "@/components/ui/button";
import type { FormField } from "@/db/schema/forms";

export default async function FormDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getTenantContext();

  const form = await getFormById(ctx, id);
  if (!form) notFound();

  const [tenant, submissions] = await Promise.all([
    getMyTenant(ctx),
    getFormSubmissions(ctx, id),
  ]);

  async function saveFields(formData: FormData) {
    "use server";
    const fields = JSON.parse(String(formData.get("fields") ?? "[]")) as FormField[];
    await updateFormFields(id, fields);
  }

  async function toggleActive() {
    "use server";
    await setFormActive(id, !form!.isActive);
  }

  const publicUrl = `/f/${tenant?.slug}/${form.slug}`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{form.name}</h1>
          <p className="text-sm text-muted-foreground">{publicUrl}</p>
        </div>
        <form action={toggleActive}>
          <Button variant={form.isActive ? "destructive" : "default"}>
            {form.isActive ? "Desactivar" : "Activar"}
          </Button>
        </form>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Campos</h2>
        <form action={saveFields} className="flex max-w-lg flex-col gap-3">
          <FormFieldsEditor name="fields" initialFields={form.fields} />
          <Button type="submit" className="self-start">
            Guardar campos
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Envíos recientes</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Datos</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2 text-muted-foreground">
                    {s.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-4 py-2">{JSON.stringify(s.data)}</td>
                </tr>
              ))}
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                    Sin envíos todavía.
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
