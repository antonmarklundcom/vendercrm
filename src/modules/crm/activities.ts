import { and, desc, eq, type SQL } from "drizzle-orm";
import { activities } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";

export type ActivityType =
  | "note"
  | "call"
  | "stage_change"
  | "form_submission"
  | "quote_sent"
  | "system";

export async function addActivity(
  ctx: TenantContext,
  input: {
    contactId: string;
    dealId?: string | null;
    type: ActivityType;
    payload?: unknown;
    userId?: string | null;
  },
): Promise<string> {
  const id = newId();
  await tenantDb(ctx).insert(activities, {
    id,
    contactId: input.contactId,
    dealId: input.dealId ?? null,
    type: input.type,
    payload: (input.payload as object) ?? null,
    userId: input.userId ?? ctx.userId ?? null,
  });
  return id;
}

// Unified timeline for a contact (PLAN.md §5): all activities newest-first.
// WhatsApp messages and quotes are folded in by later sub-phases that read
// their own tables alongside this.
export async function listContactActivities(
  ctx: TenantContext,
  contactId: string,
) {
  return tenantDb(ctx)
    .select(activities, eq(activities.contactId, contactId))
    .orderBy(desc(activities.createdAt));
}

export async function listDealActivities(ctx: TenantContext, dealId: string) {
  const cond: SQL = and(eq(activities.dealId, dealId))!;
  return tenantDb(ctx)
    .select(activities, cond)
    .orderBy(desc(activities.createdAt));
}
