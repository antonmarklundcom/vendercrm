import { createEventBus } from "@/lib/events";

// Nota de venta domain events (PLAN.md §15.5 J1).
//
// `document.paid` is the one with a rule attached: it fires *once*, at the
// moment the payment ledger first reaches the document total. A second
// payment on an already-paid document, or a payment that leaves a balance,
// fires nothing — otherwise "cobrado → pedile la reseña" would send two
// messages to somebody who paid in two instalments.
export type DocumentEvents = {
  "document.sent": {
    tenantId: string;
    contactId: string;
    documentId: string;
    dealId: string | null;
    number: string;
    total: number;
    currency: string;
  };
  "document.paid": {
    tenantId: string;
    contactId: string;
    documentId: string;
    dealId: string | null;
    number: string;
    total: number;
    currency: string;
  };
};

export const documentEvents = createEventBus<DocumentEvents>();
