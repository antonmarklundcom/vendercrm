import { eq } from "drizzle-orm";
import { contacts, deals } from "@/db/schema";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";
import { addTagToContact, removeTagFromContact } from "@/modules/crm/contacts";
import { moveDeal } from "@/modules/crm/deals";
import { addActivity } from "@/modules/crm/activities";
import { getOrCreateConversationForContact } from "@/modules/whatsapp/conversations";
import { sendMessage, WindowClosedError } from "@/modules/whatsapp/send";
import { isContactOptedOut } from "./optout";
import { resolveTemplate } from "./template";
import type { FlowNode } from "./graph";

export type ActionNode = Extract<FlowNode, { kind: "action" }>;

export type ActionContext = {
  contactId: string;
  dealId?: string | null;
  runId: string;
  vars: { contact?: unknown; deal?: unknown; trigger?: unknown };
};

const SEND_ACTION_TYPES = new Set(["send_wa_message", "send_wa_template"]);

// Executes one action node. Returns a JSON-serializable result recorded on the
// flow_run_steps row. Never throws for expected/business-level outcomes
// (opted-out contact, closed window) — those are recorded as `skipped`
// results so the run can continue; only truly unexpected errors propagate.
export async function executeAction(
  ctx: TenantContext,
  node: ActionNode,
  input: ActionContext,
): Promise<{ status: "ok" | "skipped" | "error"; result: unknown }> {
  const config = node.config as Record<string, unknown>;

  // Global opt-out guard (PLAN.md §7.2): a contact tagged `optout` is skipped
  // by every SEND action specifically — other actions (tag, stage move) still
  // run normally.
  if (SEND_ACTION_TYPES.has(node.type) && (await isContactOptedOut(ctx, input.contactId))) {
    return { status: "skipped", result: { reason: "contact opted out" } };
  }

  switch (node.type) {
    case "send_wa_message": {
      const body = resolveTemplate(String(config.body ?? ""), input.vars);
      try {
        const conversationId = await getOrCreateConversationForContact(
          ctx,
          input.contactId,
        );
        const messageId = await sendMessage(ctx, {
          conversationId,
          kind: "text",
          body,
          automationRunId: input.runId,
        });
        return { status: "ok", result: { messageId } };
      } catch (err) {
        if (err instanceof WindowClosedError) {
          return { status: "skipped", result: { reason: "24h window closed" } };
        }
        throw err;
      }
    }

    case "send_wa_template": {
      const conversationId = await getOrCreateConversationForContact(
        ctx,
        input.contactId,
      );
      const messageId = await sendMessage(ctx, {
        conversationId,
        kind: "template",
        templateName: String(config.templateName ?? ""),
        templateLanguage: String(config.templateLanguage ?? "es"),
        automationRunId: input.runId,
      });
      return { status: "ok", result: { messageId } };
    }

    case "add_tag": {
      await addTagToContact(ctx, input.contactId, String(config.tagId ?? ""));
      return { status: "ok", result: { tagId: config.tagId } };
    }

    case "remove_tag": {
      await removeTagFromContact(ctx, input.contactId, String(config.tagId ?? ""));
      return { status: "ok", result: { tagId: config.tagId } };
    }

    case "move_deal_stage": {
      if (!input.dealId) {
        return { status: "skipped", result: { reason: "no deal on this run" } };
      }
      await moveDeal(ctx, input.dealId, String(config.stageId ?? ""));
      return { status: "ok", result: { stageId: config.stageId } };
    }

    case "assign_user": {
      if (!input.dealId) {
        return { status: "skipped", result: { reason: "no deal on this run" } };
      }
      const userId = String(config.userId ?? "");
      await tenantDb(ctx).update(deals, { assignedUserId: userId }, eq(deals.id, input.dealId));
      return { status: "ok", result: { userId } };
    }

    case "create_activity": {
      const body = resolveTemplate(String(config.body ?? ""), input.vars);
      await addActivity(ctx, {
        contactId: input.contactId,
        dealId: input.dealId,
        type: "note",
        payload: { body, automated: true },
        userId: null,
      });
      return { status: "ok", result: { body } };
    }

    case "notify_user": {
      // In-app notification is out of scope for Phase 1's UI surface; recorded
      // as a system activity so it's visible in the timeline for now.
      await addActivity(ctx, {
        contactId: input.contactId,
        dealId: input.dealId,
        type: "system",
        payload: { notify: config.userId, message: config.message },
        userId: null,
      });
      return { status: "ok", result: {} };
    }

    default:
      return { status: "error", result: { reason: `unknown action type ${node.type}` } };
  }
}

export async function loadActionVars(
  ctx: TenantContext,
  contactId: string,
  dealId: string | null | undefined,
  trigger: unknown,
): Promise<ActionContext["vars"]> {
  const [contact] = await tenantDb(ctx).select(contacts, eq(contacts.id, contactId));
  const deal = dealId
    ? (await tenantDb(ctx).select(deals, eq(deals.id, dealId)))[0]
    : undefined;
  return { contact, deal, trigger };
}
