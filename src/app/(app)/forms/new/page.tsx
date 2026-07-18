import { createForm } from "@/modules/forms/actions";
import { getDefaultPipeline, getStagesForPipeline, listPipelines } from "@/modules/crm/pipeline-queries";
import { getTenantContext } from "@/modules/tenancy/context";
import { FormFieldsEditor } from "@/components/form-fields-editor";
import { Button } from "@/components/ui/button";
import type { FormField, FormSettings } from "@/db/schema/forms";

const DEFAULT_FIELDS: FormField[] = [
  { key: "name", label: "Nombre", type: "text", required: true },
  { key: "phone", label: "Teléfono", type: "phone", required: true },
];

export default async function NewFormPage() {
  const ctx = await getTenantContext();
  const [pipelines, defaultPipeline] = await Promise.all([
    listPipelines(ctx),
    getDefaultPipeline(ctx),
  ]);
  const stages = defaultPipeline ? await getStagesForPipeline(ctx, defaultPipeline.id) : [];

  async function action(formData: FormData) {
    "use server";

    const fields = JSON.parse(String(formData.get("fields") ?? "[]")) as FormField[];
    const targetPipelineId = String(formData.get("targetPipelineId") ?? "") || undefined;
    const targetStageId = String(formData.get("targetStageId") ?? "") || undefined;

    const settings: FormSettings = {};
    if (targetPipelineId && targetStageId) {
      settings.targetPipelineId = targetPipelineId;
      settings.targetStageId = targetStageId;
    }

    await createForm({
      name: String(formData.get("name") ?? ""),
      fields,
      settings,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nuevo formulario</h1>

      <form action={action} className="flex max-w-lg flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Nombre
          <input
            name="name"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <div>
          <p className="mb-2 text-sm font-medium">Campos (el teléfono es obligatorio)</p>
          <FormFieldsEditor name="fields" initialFields={DEFAULT_FIELDS} />
        </div>

        {pipelines.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">
              Al enviar, crear un negocio en (opcional)
            </p>
            <div className="flex gap-2">
              <select
                name="targetPipelineId"
                defaultValue={defaultPipeline?.id}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="">No crear negocio</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                name="targetStageId"
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <Button type="submit" className="self-start">
          Crear formulario
        </Button>
      </form>
    </div>
  );
}
