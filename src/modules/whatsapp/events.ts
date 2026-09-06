import { createEventBus } from "@/lib/events";

export type WhatsappEvents = {
  "wa.message_received": {
    tenantId: string;
    conversationId: string;
    contactId: string;
    messageId: string;
    /**
     * The message is a voice note whose transcription is still queued
     * (PLAN.md §15.10 W1). Listeners that read the *text* of the message —
     * the automation trigger chain, and through it the AI auto-reply — skip
     * it here and act on `wa.message_transcribed` instead, so a voice note
     * is answered once, with words in it, rather than twice or empty.
     * Listeners that only care that something arrived (the inbox
     * notification and its push) act immediately either way: a rep should
     * not wait on a provider to learn a customer wrote.
     */
    transcriptPending?: boolean;
  };
  /**
   * A queued transcription reached a terminal state — `done`, `failed` or
   * `skipped`. Emitted exactly once per deferred voice note, so the chain
   * deferred above runs whether or not the words were recovered.
   */
  "wa.message_transcribed": {
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
