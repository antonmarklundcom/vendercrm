import { z } from "zod";
import type { NotificationRow } from "./notifications";

// Per-user push preferences (PLAN.md §15.5 J2, §15.8 P2), stored as
// `users.push_prefs`. No database and no env in this file — it is the shape
// and the decision, so both are testable without either.
//
// Muting is about the *push*, never the row. A person who silences
// "mensajes nuevos" still finds every one of them in the bell when they open
// the app; what they turned off is the phone buzzing. That distinction is
// what makes this safe to expose as five checkboxes rather than a support
// question about missed messages.

/** The kinds a user can silence — the `notifications.kind` enum, plus the one
 * push that has no row behind it (an inbound WhatsApp message; see fanout.ts
 * for why those don't fill the bell). `system` is deliberately absent: it is
 * what the platform says when something needs a person, and there is no
 * version of this product where that should arrive silently. */
export const PUSH_KINDS = [
  "inbound_message",
  "assignment",
  "task_due",
  "automation",
] as const;

export type PushKind = (typeof PUSH_KINDS)[number];

/** Every kind a push can carry, including the ones that cannot be muted. */
export type PushNotificationKind = NotificationRow["kind"];

/**
 * Only the muted kinds are stored. NULL, `{}` and a row written before a new
 * kind existed all mean the same thing — everything on — so adding a kind
 * later needs no backfill and silently mutes nobody.
 */
export const pushPrefsSchema = z
  .object(
    Object.fromEntries(PUSH_KINDS.map((kind) => [kind, z.boolean().optional()])) as {
      [K in PushKind]: z.ZodOptional<z.ZodBoolean>;
    },
  )
  .strict();

export type PushPrefs = z.infer<typeof pushPrefsSchema>;

/** Reads whatever is in the column — including the shapes a hand-edited row
 * or an older version of this code could leave there — without throwing. An
 * unreadable preference means "no preference", which is the safe side: the
 * user hears about their work. */
export function parsePushPrefs(value: unknown): PushPrefs {
  const parsed = pushPrefsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** `true` when this user has switched this kind off. Unknown kinds — `system`,
 * or one added by a later phase — are never muted. */
export function isKindMuted(value: unknown, kind: PushNotificationKind): boolean {
  if (!isMutableKind(kind)) return false;
  return parsePushPrefs(value)[kind] === false;
}

export function isMutableKind(kind: string): kind is PushKind {
  return (PUSH_KINDS as readonly string[]).includes(kind);
}

/**
 * Applies the settings form's answer. Stores only the `false` entries, so the
 * column stays a short list of what somebody turned off rather than a
 * snapshot of every kind that existed the day they last opened settings.
 */
export function applyPushPrefs(current: unknown, enabled: Record<string, boolean>): PushPrefs {
  const next: PushPrefs = { ...parsePushPrefs(current) };
  for (const [kind, on] of Object.entries(enabled)) {
    if (!isMutableKind(kind)) continue;
    if (on) delete next[kind];
    else next[kind] = false;
  }
  return next;
}
