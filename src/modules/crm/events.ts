import { EventBus } from "@/lib/events/bus";

export type CrmEventMap = {
  "contact.created": { tenantId: string; contactId: string };
  "deal.stage_changed": {
    tenantId: string;
    dealId: string;
    contactId: string;
    fromStageId: string;
    toStageId: string;
  };
  "tag.added": { tenantId: string; contactId: string; tagId: string };
};

export const crmEvents = new EventBus<CrmEventMap>();
