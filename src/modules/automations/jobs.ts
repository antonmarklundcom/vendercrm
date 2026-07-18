import { registerHandler } from "@/worker/handlers";
import { enqueue } from "@/lib/queue";
import { on } from "@/lib/events";
import { tenantContextFromJob } from "@/modules/tenancy/context";
import {
  triggerFlows,
  resumeRun,
  AUTOMATION_TRIGGER,
  AUTOMATION_RESUME,
  type TriggerMatchFields,
} from "./engine";
import type { Flow } from "./flows";
import { handleInboundReply } from "./inbound";

export const AUTOMATION_INBOUND_REPLY = "automation.inbound_reply";

type TriggerJobPayload = {
  triggerType: Flow["triggerType"];
  contactId: string;
  dealId?: string | null;
  payload: unknown;
  matchFields: TriggerMatchFields;
};

registerHandler(AUTOMATION_TRIGGER, async (payload, tenantId) => {
  if (!tenantId) return;
  const p = payload as TriggerJobPayload;
  const ctx = tenantContextFromJob({ tenantId });
  await triggerFlows(ctx, p.triggerType, {
    contactId: p.contactId,
    dealId: p.dealId,
    payload: p.payload,
    matchFields: p.matchFields,
  });
});

registerHandler(AUTOMATION_RESUME, async (payload, tenantId) => {
  if (!tenantId) return;
  const p = payload as { runId: string; nodeId: string; kind: "delay" | "reply" | "timeout" };
  const ctx = tenantContextFromJob({ tenantId });
  await resumeRun(ctx, p.runId, { nodeId: p.nodeId, kind: p.kind });
});

registerHandler(AUTOMATION_INBOUND_REPLY, async (payload, tenantId) => {
  if (!tenantId) return;
  const p = payload as { contactId: string; text: string | null };
  const ctx = tenantContextFromJob({ tenantId });
  await handleInboundReply(ctx, p.contactId, p.text);
});

// --- Event wiring (PLAN.md §5, §7.2) --------------------------------------------
// Each domain event enqueues a durable job rather than running engine logic
// inline in the emitter's request/webhook — trigger matching and reply
// handling get the queue's retry/backoff for free, and a slow flow match
// never blocks the CRM write or webhook ack that raised the event.

on("contact.created", async (e) => {
  await enqueue(
    AUTOMATION_TRIGGER,
    {
      triggerType: "contact_created",
      contactId: e.contactId,
      matchFields: {},
      payload: e,
    } satisfies TriggerJobPayload,
    { tenantId: e.tenantId },
  );
});

on("form.submitted", async (e) => {
  await enqueue(
    AUTOMATION_TRIGGER,
    {
      triggerType: "form_submitted",
      contactId: e.contactId,
      dealId: e.dealId,
      matchFields: { formId: e.formId },
      payload: e,
    } satisfies TriggerJobPayload,
    { tenantId: e.tenantId },
  );
});

on("deal.stage_changed", async (e) => {
  await enqueue(
    AUTOMATION_TRIGGER,
    {
      triggerType: "deal_stage_changed",
      contactId: e.contactId,
      dealId: e.dealId,
      matchFields: { pipelineId: e.pipelineId, stageId: e.toStageId },
      payload: e,
    } satisfies TriggerJobPayload,
    { tenantId: e.tenantId },
  );
});

on("tag.added", async (e) => {
  await enqueue(
    AUTOMATION_TRIGGER,
    {
      triggerType: "tag_added",
      contactId: e.contactId,
      matchFields: { tagId: e.tagId },
      payload: e,
    } satisfies TriggerJobPayload,
    { tenantId: e.tenantId },
  );
});

on("wa.message_received", async (e) => {
  await enqueue(
    AUTOMATION_TRIGGER,
    {
      triggerType: "wa_message",
      contactId: e.contactId,
      matchFields: { text: e.text },
      payload: e,
    } satisfies TriggerJobPayload,
    { tenantId: e.tenantId },
  );
  await enqueue(
    AUTOMATION_INBOUND_REPLY,
    { contactId: e.contactId, text: e.text },
    { tenantId: e.tenantId },
  );
});
