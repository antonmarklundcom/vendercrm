import { createEventBus } from "@/lib/events";

// Contract domain events (PLAN.md §17.2 P13). `contract.accepted` is the one
// with a listener: it closes the `contract_accepted` trigger entry P1 left
// unemitted (docs/log/p1.md "Known issues").
export type ContractEvents = {
  "contract.accepted": {
    tenantId: string;
    contactId: string;
    contractId: string;
    dealId: string | null;
    number: string;
  };
};

export const contractEvents = createEventBus<ContractEvents>();
