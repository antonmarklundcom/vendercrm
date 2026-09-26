import { Resend } from "resend";
import type { EmailProvider, ProviderMessage, ProviderResult } from "./types";

// The Resend call exactly as lib/email/index.ts made it before providers
// existed (PLAN-EMAIL.md E1: default behaviour byte-for-byte unchanged).
export function createResendProvider(apiKey: string): EmailProvider {
  const client = new Resend(apiKey);
  return {
    name: "resend",
    async send(message: ProviderMessage): Promise<ProviderResult> {
      const result = await client.emails.send({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        replyTo: message.replyTo,
        attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
      });
      if (result.error) {
        console.error("[email] Resend rejected the send:", result.error);
        return { ok: false };
      }
      return { ok: true, providerId: result.data?.id };
    },
  };
}
