import { eq, inArray } from "drizzle-orm";
import { tenantDb } from "@/modules/tenancy/db";
import { contacts, deals, pipelines, stages } from "@/db/schema/crm";
import type { TenantContext } from "@/modules/tenancy/context";

export async function listPipelines(ctx: TenantContext) {
  const rows = await tenantDb(ctx).findMany(pipelines);
  return rows.sort((a, b) => a.position - b.position);
}

export async function getDefaultPipeline(ctx: TenantContext) {
  const all = await listPipelines(ctx);
  return all[0] ?? null;
}

export async function getStagesForPipeline(ctx: TenantContext, pipelineId: string) {
  const rows = await tenantDb(ctx).findMany(stages, eq(stages.pipelineId, pipelineId));
  return rows.sort((a, b) => a.position - b.position);
}

export type DealWithContact = typeof deals.$inferSelect & {
  contactName: string;
  contactPhone: string;
};

export async function getBoard(ctx: TenantContext, pipelineId: string) {
  const scoped = tenantDb(ctx);

  const [stageRows, dealRows] = await Promise.all([
    getStagesForPipeline(ctx, pipelineId),
    scoped.findMany(deals, eq(deals.pipelineId, pipelineId)),
  ]);

  const contactIds = [...new Set(dealRows.map((d) => d.contactId))];
  const contactRows =
    contactIds.length > 0 ? await scoped.findMany(contacts, inArray(contacts.id, contactIds)) : [];
  const contactsById = new Map(contactRows.map((c) => [c.id, c]));

  const dealsWithContact: DealWithContact[] = dealRows
    .map((d) => ({
      ...d,
      contactName: contactsById.get(d.contactId)?.name ?? "?",
      contactPhone: contactsById.get(d.contactId)?.phone ?? "",
    }))
    .sort((a, b) => a.position - b.position);

  return stageRows.map((stage) => ({
    stage,
    deals: dealsWithContact.filter((d) => d.stageId === stage.id),
  }));
}

export async function getDealById(ctx: TenantContext, id: string) {
  return tenantDb(ctx).findFirst(deals, eq(deals.id, id));
}
