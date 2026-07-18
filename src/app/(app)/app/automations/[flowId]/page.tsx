import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getFlow, listFlowVersions } from "@/modules/automations/flows";
import { listForms } from "@/modules/forms/service";
import { getDefaultPipeline, listStages } from "@/modules/crm/pipelines";
import { listTags } from "@/modules/crm/contacts";
import { getAccountForTenant, listApprovedTemplates } from "@/modules/whatsapp";
import { FlowEditor, type ReferenceData } from "./flow-editor";
import type { FlowGraph } from "@/modules/automations/graph";

export default async function FlowEditorPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const ctx = await requireTenantContext();

  const flow = await getFlow(ctx, flowId);
  if (!flow) notFound();

  const versions = await listFlowVersions(ctx, flowId);
  const latest = versions[0] ?? null; // listFlowVersions orders desc by version
  const graph = (latest?.graph as FlowGraph | undefined) ?? { nodes: [], edges: [] };

  const [pipeline, forms, tags, waAccount] = await Promise.all([
    getDefaultPipeline(ctx),
    listForms(ctx),
    listTags(ctx),
    getAccountForTenant(ctx),
  ]);
  const stages = pipeline ? await listStages(ctx, pipeline.id) : [];
  const templates = waAccount ? await listApprovedTemplates(ctx, waAccount.id) : [];

  const reference: ReferenceData = {
    forms: forms.map((f) => ({ id: f.id, name: f.name })),
    stages: stages.map((s) => ({ id: s.id, name: s.name })),
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    templates: templates.map((t) => ({ name: t.name, language: t.language })),
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{flow.name}</h1>
        <p className="text-sm text-muted-foreground">
          Estado: {flow.status} ·{" "}
          <a href={`/app/automations/${flowId}/runs`} className="hover:underline">
            Ver ejecuciones
          </a>
        </p>
      </div>
      <FlowEditor
        flowId={flowId}
        initialNodes={graph.nodes.map((n) => ({
          id: n.id,
          type: "flowNode",
          position: n.position,
          data: {
            kind: n.kind,
            type: n.type,
            label: n.type.replace(/_/g, " "),
            config: n.config as Record<string, unknown>,
          },
        }))}
        initialEdges={graph.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
        }))}
        latestVersionId={latest?.id ?? null}
        isPublished={!!latest?.publishedAt}
        reference={reference}
      />
    </div>
  );
}
