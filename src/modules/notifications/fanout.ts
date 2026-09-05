// Who a push goes to, and how often (PLAN.md §15.5 J2, §15.8 P2).
//
// Pure by design: both rules here are the ones most likely to be got wrong,
// and neither needs a database to be shown correct.

/**
 * The recipients of an inbound WhatsApp message.
 *
 * An owned conversation belongs to its owner and nobody else — buzzing the
 * whole team about a message somebody is already handling is how a team turns
 * pushes off. An *unowned* conversation is everyone's problem, so it goes to
 * every active member: the point of the push is that a stranger's first
 * message is not sitting unread while the shop is open.
 *
 * `activeUserIds` is the tenant's non-banned membership. An assignee missing
 * from it (deactivated this morning, moved to another business) falls back to
 * the team rather than pushing into a queue nobody is reading.
 */
export function recipientsForInbound(
  assignedUserId: string | null | undefined,
  activeUserIds: readonly string[],
): string[] {
  if (assignedUserId && activeUserIds.includes(assignedUserId)) return [assignedUserId];
  return [...activeUserIds];
}

/** One push per conversation per two minutes (§15.5 J2). A customer typing
 * four lines in a row is one arrival, not four. */
export const INBOUND_PUSH_WINDOW_MS = 2 * 60 * 1000;

/**
 * The throttle behind that rule.
 *
 * In memory, and honest about it: §2.1 pins this product to a single Node
 * process, where the WhatsApp webhook and the queue worker are the same
 * process, so a Map is the whole mechanism. A restart lets one extra push
 * through per conversation — the failure mode is a duplicate buzz right after
 * a deploy, which is not worth a table, a row lock and a write on the hottest
 * path in the product. If the worker is ever lifted onto its own process
 * (§2.1's escape hatch, §15.6), this becomes a column on `conversations` and
 * the callers do not change.
 */
export class ConversationPushThrottle {
  private readonly lastPushAt = new Map<string, number>();

  constructor(private readonly windowMs: number = INBOUND_PUSH_WINDOW_MS) {}

  /**
   * `true` — and the window restarts — when this conversation may push now.
   * Deliberately one call rather than a check plus a record: two callers
   * asking at once must not both be told yes.
   */
  claim(conversationId: string, now: Date = new Date()): boolean {
    const at = now.getTime();
    const last = this.lastPushAt.get(conversationId);
    if (last !== undefined && at - last < this.windowMs) return false;

    this.prune(at);
    this.lastPushAt.set(conversationId, at);
    return true;
  }

  /** How many conversations the throttle is currently holding. Exposed so the
   * pruning above is testable — an unbounded Map on this path is a slow leak
   * in a process that stays up for weeks. */
  get size(): number {
    return this.lastPushAt.size;
  }

  /** Keeps the Map the size of "conversations active in the last two minutes"
   * rather than "every conversation since the last deploy" — this runs on
   * every inbound message, in a process that is expected to stay up. */
  private prune(now: number): void {
    for (const [id, at] of this.lastPushAt) {
      if (now - at >= this.windowMs) this.lastPushAt.delete(id);
    }
  }
}

/** The process-wide instance the inbound hook uses. */
export const inboundThrottle = new ConversationPushThrottle();
