import { createEventBus } from "@/lib/events";

// Quote domain events (PLAN.md §15.5 J1). Same shape as crm/events.ts: the
// module fires, modules/automations/triggers.ts listens. Quotes know nothing
// about flows, which is what keeps the automation library from growing a
// tentacle into every module it can trigger on.
export type QuoteEvents = {
  "quote.sent": {
    tenantId: string;
    contactId: string;
    quoteId: string;
    dealId: string | null;
    number: string;
    total: number;
    currency: string;
  };
  /**
   * Emitted by the public accept page in P6 (§15.5 J4b). Declared now so P6
   * adds an emit line and nothing else — no enum, no listener, no migration.
   */
  "quote.accepted": {
    tenantId: string;
    contactId: string;
    quoteId: string;
    dealId: string | null;
    number: string;
    total: number;
    currency: string;
  };
  /** Emitted by the public reject page (§15.8 P6), alongside "quote.accepted"
   *  above. No automation trigger listens yet — P1 only declared
   *  `quote_accepted` — but the event exists so one can later without a
   *  second migration. */
  "quote.rejected": {
    tenantId: string;
    contactId: string;
    quoteId: string;
    dealId: string | null;
    number: string;
  };
};

export const quoteEvents = createEventBus<QuoteEvents>();
