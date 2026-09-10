// The rules around the ops token's one-time reveal (PLAN.md §18.1 point 1:
// "Shown in plaintext exactly once", §18.4: "one-time reveal dialog").
//
// This lives outside the component because it is the part that can be wrong in
// a way nobody notices until a token is already lost: the owner created one,
// the plaintext rendered in an inline panel he wasn't looking at, and a refresh
// took it with it — the hash is all that is stored, so there was nothing to
// recover. The component below now refuses to let the reveal go until it has
// been acknowledged, and these predicates are what "acknowledged" means.
//
// Both flags are keyed on the plaintext rather than being booleans so that a
// second token created in the same session starts unacknowledged again — the
// bug where token B inherits token A's "yes I copied it" is the same loss.

export type TokenRevealState = {
  /** The plaintext on screen, or null when no token has been created yet. */
  plaintext: string | null;
  /** The plaintext the owner ticked the copy confirmation for. */
  acknowledgedFor: string | null;
  /** The plaintext the owner explicitly closed the dialog on. */
  closedFor: string | null;
};

/** Is the reveal dialog on screen? */
export function isRevealOpen(state: TokenRevealState): boolean {
  return state.plaintext !== null && state.closedFor !== state.plaintext;
}

/** Has the owner confirmed he copied the token currently being revealed? */
export function isRevealAcknowledged(state: TokenRevealState): boolean {
  return state.plaintext !== null && state.acknowledgedFor === state.plaintext;
}

/** Whether the dialog's only exit — the Done button — is enabled. */
export function canCloseReveal(state: TokenRevealState): boolean {
  return isRevealAcknowledged(state);
}

/**
 * Whether leaving the page right now would silently destroy the token, which
 * is the condition for holding a `beforeunload` listener.
 */
export function shouldWarnBeforeUnload(state: TokenRevealState): boolean {
  return isRevealOpen(state) && !isRevealAcknowledged(state);
}

/** The parts of `BeforeUnloadEvent` a warning has to touch. */
export type UnloadEventLike = {
  preventDefault: () => void;
  returnValue: unknown;
};

/**
 * Asks the browser for its native "leave site?" confirmation. Modern browsers
 * show their own wording and ignore `returnValue`'s text, but assigning a
 * non-empty string is still what arms the prompt in older ones.
 *
 * Returns whether it warned, so a caller (and a test) can tell the difference
 * between "guarded" and "nothing at risk".
 */
export function warnBeforeUnload(
  event: UnloadEventLike,
  state: TokenRevealState,
  message: string,
): boolean {
  if (!shouldWarnBeforeUnload(state)) return false;
  event.preventDefault();
  event.returnValue = message;
  return true;
}
