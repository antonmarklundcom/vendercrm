import { getTenantContext } from "@/modules/tenancy/context";
import { getBoard, getDefaultPipeline, listPipelines } from "@/modules/crm/pipeline-queries";
import { listContacts } from "@/modules/crm/queries";
import { createDeal, createPipeline } from "@/modules/crm/pipeline-actions";
import { KanbanBoard } from "@/components/kanban-board";
import { Button } from "@/components/ui/button";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const { pipeline: pipelineIdParam } = await searchParams;
  const ctx = await getTenantContext();

  const allPipelines = await listPipelines(ctx);

  if (allPipelines.length === 0) {
    async function seedDefault() {
      "use server";
      await createPipeline("Ventas");
    }

    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">Todavía no hay ningún pipeline.</p>
        <form action={seedDefault}>
          <Button type="submit">Crear pipeline por defecto</Button>
        </form>
      </div>
    );
  }

  const activePipeline =
    allPipelines.find((p) => p.id === pipelineIdParam) ?? (await getDefaultPipeline(ctx))!;

  const [board, contactsList] = await Promise.all([
    getBoard(ctx, activePipeline.id),
    listContacts(ctx),
  ]);

  async function createDealAction(formData: FormData) {
    "use server";
    const stageId = String(formData.get("stageId") ?? "");
    const contactId = String(formData.get("contactId") ?? "");
    const title = String(formData.get("title") ?? "");
    if (!stageId || !contactId || !title) return;

    await createDeal({
      contactId,
      pipelineId: activePipeline.id,
      stageId,
      title,
      value: formData.get("value") ? Number(formData.get("value")) : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        {allPipelines.length > 1 && (
          <form className="flex gap-2">
            <select
              name="pipeline"
              defaultValue={activePipeline.id}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {allPipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              Cambiar
            </Button>
          </form>
        )}
      </div>

      {contactsList.length > 0 && (
        <form action={createDealAction} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Contacto
            <select
              name="contactId"
              required
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {contactsList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Título
            <input
              name="title"
              required
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Valor (opcional)
            <input
              type="number"
              name="value"
              className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Etapa
            <select
              name="stageId"
              required
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {board.map(({ stage }) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm">
            Nuevo negocio
          </Button>
        </form>
      )}

      <KanbanBoard
        initialColumns={board.map(({ stage, deals }) => ({
          stage: { id: stage.id, name: stage.name, color: stage.color },
          deals: deals.map((d) => ({
            id: d.id,
            title: d.title,
            value: d.value,
            currency: d.currency,
            contactName: d.contactName,
            contactPhone: d.contactPhone,
          })),
        }))}
      />
    </div>
  );
}
