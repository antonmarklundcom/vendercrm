// One shape every outbound email provider implements (PLAN-EMAIL.md E1), so
// lib/email/index.ts's `sendEmail()` stays the only place that decides
// *whether* and *what* to send, and a provider module only decides *how*.

export type ProviderMessage = {
  /** RFC 5322 mailbox: `addr@domain` or `"Display Name" <addr@domain>`. */
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
};

/**
 * `ok: false` is a rejection the provider answered with (already logged by
 * the provider, without the body). A thrown error is a transport failure —
 * `sendEmail()` catches and logs those itself, exactly as before providers.
 */
export type ProviderResult = { ok: true; providerId?: string } | { ok: false };

export interface EmailProvider {
  readonly name: "resend" | "cloudflare";
  send(message: ProviderMessage): Promise<ProviderResult>;
}
