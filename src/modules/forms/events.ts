import { EventBus } from "@/lib/events/bus";

export type FormsEventMap = {
  "form.submitted": {
    tenantId: string;
    formId: string;
    contactId: string;
    submissionId: string;
  };
};

export const formsEvents = new EventBus<FormsEventMap>();
