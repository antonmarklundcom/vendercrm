import { eq } from "drizzle-orm";
import { contacts, deals, contactTags } from "@/db/schema";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";
import type { FlowNode } from "./graph";

export type ConditionNode = Extract<FlowNode, { kind: "condition" }>;

// Evaluates a condition node against live data (not just the run's frozen
// trigger context) and returns which branch to follow (PLAN.md §7.1).
export async function evaluateCondition(
  ctx: TenantContext,
  node: ConditionNode,
  input: { contactId: string; dealId?: string | null },
): Promise<"yes" | "no"> {
  const config = node.config as Record<string, unknown>;

  switch (node.type) {
    case "contact_field": {
      const [contact] = await tenantDb(ctx).select(
        contacts,
        eq(contacts.id, input.contactId),
      );
      if (!contact) return "no";
      const field = String(config.field ?? "");
      const expected = config.equals;
      const actual = (contact as unknown as Record<string, unknown>)[field];
      return actual === expected ? "yes" : "no";
    }

    case "contact_tag": {
      const tagId = String(config.tagId ?? "");
      const tdb = tenantDb(ctx);
      const links = await tdb.select(contactTags, eq(contactTags.contactId, input.contactId));
      return links.some((l) => l.tagId === tagId) ? "yes" : "no";
    }

    case "deal_stage": {
      if (!input.dealId) return "no";
      const [deal] = await tenantDb(ctx).select(deals, eq(deals.id, input.dealId));
      if (!deal) return "no";
      return deal.stageId === config.stageId ? "yes" : "no";
    }

    case "business_hours": {
      // Tenant timezone-aware business-hours window (PLAN.md §7.1). Falls
      // back to a plain 9-18 local-time check; tenant settings integration
      // is intentionally simple for Phase 1.
      const start = Number(config.startHour ?? 9);
      const end = Number(config.endHour ?? 18);
      const hour = new Date().getHours();
      return hour >= start && hour < end ? "yes" : "no";
    }

    case "has_responded_since": {
      // Placeholder evaluated against context.trigger by the engine caller
      // when richer state (conversation lastInboundAt) is wired in; defaults
      // to "no" (conservative) when the check can't be answered here.
      return "no";
    }

    default:
      return "no";
  }
}
