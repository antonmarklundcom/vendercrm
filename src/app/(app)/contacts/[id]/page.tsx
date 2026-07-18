import { notFound } from "next/navigation";
import { getTenantContext } from "@/modules/tenancy/context";
import {
  getContactActivities,
  getContactById,
  getContactTags,
  listTags,
} from "@/modules/crm/queries";
import { addContactTag, addNote, removeContactTag, updateContact } from "@/modules/crm/actions";
import { Button } from "@/components/ui/button";

const ACTIVITY_LABELS: Record<string, string> = {
  note: "Nota",
  call: "Llamada",
  stage_change: "Cambio de etapa",
  form_submission: "Formulario enviado",
  quote_sent: "Presupuesto enviado",
  system: "Sistema",
};

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getTenantContext();

  const contact = await getContactById(ctx, id);
  if (!contact) notFound();

  const [contactTagsList, allTags, timeline] = await Promise.all([
    getContactTags(ctx, id),
    listTags(ctx),
    getContactActivities(ctx, id),
  ]);

  const contactTagIds = new Set(contactTagsList.map((t) => t.id));
  const availableTags = allTags.filter((t) => !contactTagIds.has(t.id));

  async function updateAction(formData: FormData) {
    "use server";
    await updateContact(id, {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? "") || undefined,
      notes: String(formData.get("notes") ?? "") || undefined,
    });
  }

  async function addNoteAction(formData: FormData) {
    "use server";
    const body = String(formData.get("body") ?? "");
    if (body.trim()) await addNote(id, body);
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <div>
          <h1 className="text-2xl font-semibold">{contact.name}</h1>
          <p className="text-sm text-muted-foreground">{contact.phone}</p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Etiquetas</h2>
          <div className="flex flex-wrap gap-2">
            {contactTagsList.map((t) => {
              async function remove() {
                "use server";
                await removeContactTag(id, t.id);
              }
              return (
                <form key={t.id} action={remove}>
                  <button
                    type="submit"
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{ borderColor: t.color, color: t.color }}
                  >
                    {t.name} ×
                  </button>
                </form>
              );
            })}
            {contactTagsList.length === 0 && (
              <span className="text-sm text-muted-foreground">Sin etiquetas.</span>
            )}
          </div>
          {availableTags.length > 0 && (
            <form
              action={async (formData: FormData) => {
                "use server";
                const tagId = String(formData.get("tagId") ?? "");
                if (tagId) await addContactTag(id, tagId);
              }}
              className="flex gap-2"
            >
              <select
                name="tagId"
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {availableTags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline">
                Agregar etiqueta
              </Button>
            </form>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Actividad</h2>
          <form action={addNoteAction} className="flex flex-col gap-2">
            <textarea
              name="body"
              placeholder="Agregar una nota..."
              required
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <Button type="submit" size="sm" className="self-start">
              Agregar nota
            </Button>
          </form>

          <ul className="flex flex-col gap-3">
            {timeline.map((a) => (
              <li key={a.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{ACTIVITY_LABELS[a.type] ?? a.type}</span>
                  <span>{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                </div>
                {a.type === "note" && (
                  <p className="mt-1">{(a.payload as { body?: string } | null)?.body}</p>
                )}
                {a.type === "stage_change" && (
                  <p className="mt-1 text-muted-foreground">
                    {JSON.stringify(a.payload)}
                  </p>
                )}
              </li>
            ))}
            {timeline.length === 0 && (
              <li className="text-sm text-muted-foreground">Sin actividad todavía.</li>
            )}
          </ul>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Editar contacto</h2>
        <form action={updateAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Nombre
            <input
              name="name"
              defaultValue={contact.name}
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Teléfono
            <input
              name="phone"
              defaultValue={contact.phone}
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              name="email"
              defaultValue={contact.email ?? ""}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Notas
            <textarea
              name="notes"
              defaultValue={contact.notes ?? ""}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <Button type="submit">Guardar</Button>
        </form>
      </section>
    </div>
  );
}
