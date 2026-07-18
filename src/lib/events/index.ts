// Internal event dispatcher (PLAN.md §5): a typed, synchronous fan-out — not a
// message bus. CRM/forms services emit domain events; the automation engine
// (1F) registers handlers that enqueue `automation.trigger` jobs. Keeping this
// as a plain typed registry is what decouples automations from CRM code.
//
// Every event payload carries `tenantId` so handlers can reconstruct a tenant
// context (PLAN.md §3.3) before touching data.

export type DomainEvents = {
  "contact.created": { tenantId: string; contactId: string };
  "deal.stage_changed": {
    tenantId: string;
    dealId: string;
    contactId: string;
    pipelineId: string;
    fromStageId: string | null;
    toStageId: string;
    userId: string | null;
  };
  "form.submitted": {
    tenantId: string;
    formId: string;
    submissionId: string;
    contactId: string;
    dealId: string | null;
  };
  "tag.added": { tenantId: string; contactId: string; tagId: string };
  "wa.message_received": {
    tenantId: string;
    waAccountId: string;
    conversationId: string;
    contactId: string;
    messageId: string;
    text: string | null;
  };
};

export type DomainEventName = keyof DomainEvents;

type Handler<E extends DomainEventName> = (
  payload: DomainEvents[E],
) => void | Promise<void>;

// Keyed by event name; values are Sets of that event's handlers. Typed loosely
// internally (the public on/emit signatures carry the real per-event types) so
// the generic index writes below don't fight TS's index-signature soundness.
const handlers = new Map<DomainEventName, Set<Handler<DomainEventName>>>();

export function on<E extends DomainEventName>(
  event: E,
  handler: Handler<E>,
): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as Handler<DomainEventName>);
  return () => set!.delete(handler as Handler<DomainEventName>);
}

// Fan out to every registered handler. Handlers do light work (enqueue a job),
// so awaiting them is cheap; a throwing handler must not break the emitter, so
// failures are isolated and logged.
export async function emit<E extends DomainEventName>(
  event: E,
  payload: DomainEvents[E],
): Promise<void> {
  const set = handlers.get(event);
  if (!set || set.size === 0) return;
  await Promise.all(
    [...set].map(async (h) => {
      try {
        await (h as Handler<E>)(payload);
      } catch (err) {
        console.error(`[events] handler for "${event}" failed`, err);
      }
    }),
  );
}

// Test/reset helper — clears all registrations (used by tests).
export function _resetHandlers(): void {
  handlers.clear();
}
