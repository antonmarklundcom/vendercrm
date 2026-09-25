import { describe, expect, it, vi } from "vitest";

// PLAN-EMAIL.md hard rule: with none of the new env vars set, the app
// behaves exactly as before the mailbox work — Resend carries every send
// with the same payload, and the mailbox is unavailable for every tenant
// without so much as a database read.

const resendSend = vi.fn(async () => ({ data: { id: "re_msg_1" }, error: null }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

vi.mock("@/lib/config/env", () => ({
  env: { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "no-reply@vendercrm.test" },
}));

vi.mock("@/db/client", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("the database must not be touched");
      },
    },
  ),
}));

const { sendEmail } = await import("./index");
const { platformProvider, mailboxProvider } = await import("./providers");
const { isMailboxAvailable, isMailboxConfigured } = await import("@/modules/tenancy/mailbox");

describe("mailbox work defaults off", () => {
  it("keeps Resend as the platform provider and has no mailbox provider", () => {
    expect(platformProvider()?.name).toBe("resend");
    expect(mailboxProvider()).toBeNull();
  });

  it("sends through Resend with the same payload as before", async () => {
    const attachment = { filename: "a.pdf", content: Buffer.from("x") };
    await expect(
      sendEmail({
        to: "cliente@example.com",
        subject: "Hola",
        html: "<p>Hola</p>",
        replyTo: "dueno@example.com",
        attachments: [attachment],
      }),
    ).resolves.toBe(true);
    expect(resendSend).toHaveBeenCalledWith({
      from: "no-reply@vendercrm.test",
      to: "cliente@example.com",
      subject: "Hola",
      html: "<p>Hola</p>",
      replyTo: "dueno@example.com",
      attachments: [{ filename: "a.pdf", content: attachment.content }],
    });
  });

  it("returns false (never throws) when Resend rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    resendSend.mockResolvedValueOnce({ data: null, error: { message: "nope" } } as never);
    await expect(sendEmail({ to: "a@b.c", subject: "s", html: "h" })).resolves.toBe(false);
    error.mockRestore();
  });

  it("hides the mailbox for every tenant", async () => {
    expect(isMailboxConfigured()).toBe(false);
    await expect(isMailboxAvailable({ tenantId: "any" })).resolves.toBe(false);
  });
});
