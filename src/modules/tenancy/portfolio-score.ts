import type { AccessStatus } from "./subscriptions";

// Pure half of modules/tenancy/portfolio.ts, kept apart so it can be tested
// without a database (same split as switch-target.ts).

export type PriorityInput = {
  unreadConversations: number;
  unassignedConversations: number;
  whatsappInError: boolean;
  overdueTasks: number;
  leads: number;
  access: AccessStatus;
};

/**
 * How urgently a business needs its owner, as one sortable number. Deliberately
 * simple and explainable: a customer waiting for an answer outranks everything,
 * then a broken WhatsApp connection (nothing arrives until it is fixed), then
 * work that is late, then fresh leads. Exported pure so the order is testable.
 */
export function priorityScore(b: PriorityInput): number {
  return (
    b.unreadConversations * 10 +
    b.unassignedConversations * 3 +
    (b.whatsappInError ? 25 : 0) +
    (b.access === "grace" ? 15 : 0) +
    Math.min(b.overdueTasks, 20) * 2 +
    b.leads
  );
}
