import { Resend } from "resend";
import { env } from "@/lib/config/env";
import type { TenantContext } from "@/modules/tenancy/context";
import { logEmail } from "@/modules/tenancy/email-log";
import { checkPlanLimit } from "@/modules/tenancy/limits";
import { senderFor } from "./sender";

// Transactional email (PLAN.md §10 1M, extended by §15.1/§15.8 P4 for
// per-tenant sending identity). Optional by design, the same pattern
// next.config.ts already uses for Sentry: absent config means send() logs
// and no-ops rather than the app refusing to boot or a caller having to
// branch on whether email is configured. Every call site (invite, password
// reset, expiry warning) stays a plain `await send(...)` regardless of
// environment — local dev and a fresh prod deploy before RESEND_API_KEY is
// set behave the same way, just without an email actually going out.

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Overrides `senderFor(ctx)`'s own resolution — most callers with a
   *  `ctx` don't need this; it exists for a caller that already computed a
   *  sender for another reason. */
  from?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
  /**
   * The tenant this send is for. Two things ride on it: `senderFor(ctx)`
   * resolves the tenant's own sending identity when `from`/`replyTo` are not
   * given explicitly (PLAN.md §15.1) — an existing call site like
   * automations/actions.ts's `send_email` action picks up its own domain the
   * moment it starts passing `ctx`, with no other change — and every send
   * gets an `email_log` row to count against `maxEmailsPerDay`. Absent only
   * for the handful of callers that run before any tenant is known (password
   * reset, an invite not yet tied to a session) — those stay unlogged and
   * unresolved exactly as before this phase.
   */
  ctx?: TenantContext;
  /** `automated` is the only kind the plan's `maxEmailsPerDay` cap counts —
   *  a transactional send (invite, reset, "enviar por email" on a document)
   *  always goes out regardless of volume. Defaults to `transactional`. */
  kind?: "transactional" | "automated";
};

const client = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Never throws — a failed or unconfigured send must not break the flow that
 * triggered it (accepting an invite still has to work; a request to reset a
 * password already returns a generic "check your email" regardless per
 * Better Auth's own timing-attack mitigation). Callers that need to know
 * whether the mail actually left get the boolean back; every current caller
 * also shows an on-screen fallback (the invite link, the "check your email"
 * copy) so a silent no-op here is never the only way the user finds out.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const kind = input.kind ?? "transactional";

  if (input.ctx && kind === "automated") {
    const limit = await checkPlanLimit(input.ctx.tenantId, "maxEmailsPerDay");
    if (!limit.allowed) {
      await logEmail(input.ctx, { to: input.to, subject: input.subject, kind, status: "skipped" });
      return false;
    }
  }

  let from = input.from;
  let replyTo = input.replyTo;
  if (input.ctx && (from === undefined || replyTo === undefined)) {
    const resolved = await senderFor(input.ctx);
    from = from ?? resolved.from;
    replyTo = replyTo ?? resolved.replyTo;
  }
  from = from || env.RESEND_FROM_EMAIL;

  if (!client || !from) {
    console.warn(
      `[email] RESEND_API_KEY/RESEND_FROM_EMAIL not set — skipping send to ${input.to}: ${input.subject}`,
    );
    if (input.ctx) {
      await logEmail(input.ctx, { to: input.to, subject: input.subject, kind, status: "skipped" });
    }
    return false;
  }

  try {
    const result = await client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo,
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    if (result.error) {
      console.error("[email] Resend rejected the send:", result.error);
      if (input.ctx) {
        await logEmail(input.ctx, { to: input.to, subject: input.subject, kind, status: "failed" });
      }
      return false;
    }
    if (input.ctx) {
      await logEmail(input.ctx, {
        to: input.to,
        subject: input.subject,
        kind,
        status: "sent",
        providerId: result.data?.id,
      });
    }
    return true;
  } catch (err) {
    console.error("[email] send failed:", err);
    if (input.ctx) {
      await logEmail(input.ctx, { to: input.to, subject: input.subject, kind, status: "failed" });
    }
    return false;
  }
}
