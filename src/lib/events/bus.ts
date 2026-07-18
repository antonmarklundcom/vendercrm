export type EventListener<T> = (payload: T) => void | Promise<void>;

/**
 * A typed, in-process event registry — not a message bus. `emit` fans out
 * synchronously (awaiting each listener in turn); listeners that need to do
 * real work should enqueue a job rather than doing it inline. This keeps
 * modules like automations decoupled from the CRM/forms code that triggers
 * them: those modules only ever call `emit`, and never import automations.
 */
export class EventBus<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, EventListener<never>[]>();

  on<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener as EventListener<never>);
    this.listeners.set(event, existing);
  }

  async emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void> {
    const existing = this.listeners.get(event) ?? [];
    for (const listener of existing) {
      await listener(payload as never);
    }
  }
}
