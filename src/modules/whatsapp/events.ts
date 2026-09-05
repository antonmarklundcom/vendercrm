import { createEventBus } from "@/lib/events";

export type WhatsappEvents = {
  "wa.message_received": {
    tenantId: string;
    conversationId: string;
    contactId: string;
    messageId: string;
  };
  /**
   * A conversation changed hands (PLAN.md §15.5 J2). Emitted for clearing an
   * owner too (`assignedUserId: null`) so a listener can decide — the
   * notifications module only acts on a real handover.
   */
  "wa.conversation_assigned": {
    tenantId: string;
    conversationId: string;
    contactId: string;
    assignedUserId: string | null;
    /** Who did the assigning — so nobody is notified of their own click. */
    assignedByUserId: string;
  };
};

export const whatsappEvents = createEventBus<WhatsappEvents>();
