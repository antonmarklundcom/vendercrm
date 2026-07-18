import { createContact } from "@/modules/crm/actions";
import { Button } from "@/components/ui/button";

export default function NewContactPage() {
  async function action(formData: FormData) {
    "use server";

    await createContact({
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? "") || undefined,
      notes: String(formData.get("notes") ?? "") || undefined,
      source: String(formData.get("source") ?? "") || undefined,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nuevo contacto</h1>

      <form action={action} className="flex max-w-md flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Nombre
          <input
            name="name"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Teléfono
          <input
            name="phone"
            required
            placeholder="0981234567"
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            name="email"
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Origen
          <input
            name="source"
            placeholder="whatsapp, formulario, referido..."
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Notas
          <textarea
            name="notes"
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <Button type="submit">Crear contacto</Button>
      </form>
    </div>
  );
}
