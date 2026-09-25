import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/env", () => ({ env: {} }));

const { resolveMailboxProvider, resolvePlatformProvider } = await import("./index");
const { buildCloudflarePayload, createCloudflareProvider, toCloudflareAddress } = await import(
  "./cloudflare"
);

describe("resolvePlatformProvider", () => {
  it("is Resend by default, and nothing when Resend has no key", () => {
    expect(resolvePlatformProvider({ RESEND_API_KEY: "re_test" })?.name).toBe("resend");
    expect(resolvePlatformProvider({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" })?.name).toBe(
      "resend",
    );
    expect(resolvePlatformProvider({})).toBeNull();
  });

  it("ignores Cloudflare vars unless EMAIL_PROVIDER=cloudflare", () => {
    const provider = resolvePlatformProvider({
      RESEND_API_KEY: "re_test",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_EMAIL_API_TOKEN: "tok",
    });
    expect(provider?.name).toBe("resend");
  });

  it("uses Cloudflare when selected and configured", () => {
    const provider = resolvePlatformProvider({
      EMAIL_PROVIDER: "cloudflare",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_EMAIL_API_TOKEN: "tok",
    });
    expect(provider?.name).toBe("cloudflare");
  });

  it("falls back to Resend with a warning when Cloudflare is selected but missing", () => {
    const warn = vi.fn();
    const provider = resolvePlatformProvider(
      { EMAIL_PROVIDER: "cloudflare", RESEND_API_KEY: "re_test", CLOUDFLARE_ACCOUNT_ID: "acc" },
      warn,
    );
    expect(provider?.name).toBe("resend");
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("resolveMailboxProvider", () => {
  it("is Cloudflare regardless of EMAIL_PROVIDER, or null", () => {
    expect(
      resolveMailboxProvider({
        EMAIL_PROVIDER: "resend",
        CLOUDFLARE_ACCOUNT_ID: "acc",
        CLOUDFLARE_EMAIL_API_TOKEN: "tok",
      })?.name,
    ).toBe("cloudflare");
    expect(resolveMailboxProvider({ RESEND_API_KEY: "re_test" })).toBeNull();
  });
});

describe("toCloudflareAddress", () => {
  it("splits a display name and unescapes quotes", () => {
    expect(toCloudflareAddress('"Ferretería \\"El Tornillo\\"" <ventas@tornillo.com.py>')).toEqual({
      address: "ventas@tornillo.com.py",
      name: 'Ferretería "El Tornillo"',
    });
    expect(toCloudflareAddress("Ventas <ventas@x.com>")).toEqual({
      address: "ventas@x.com",
      name: "Ventas",
    });
  });

  it("leaves a bare address alone", () => {
    expect(toCloudflareAddress("ventas@x.com")).toBe("ventas@x.com");
    expect(toCloudflareAddress("<ventas@x.com>")).toBe("ventas@x.com");
  });
});

describe("Cloudflare provider", () => {
  const message = {
    from: '"Tienda" <ventas@tienda.com.py>',
    to: "cliente@example.com",
    subject: "Hola",
    html: "<p>Hola</p>",
    replyTo: "dueno@tienda.com.py",
    attachments: [{ filename: "factura.pdf", content: Buffer.from("%PDF") }],
  };

  it("builds the documented REST payload", () => {
    expect(buildCloudflarePayload(message)).toEqual({
      to: "cliente@example.com",
      from: { address: "ventas@tienda.com.py", name: "Tienda" },
      subject: "Hola",
      html: "<p>Hola</p>",
      reply_to: "dueno@tienda.com.py",
      attachments: [
        {
          content: Buffer.from("%PDF").toString("base64"),
          filename: "factura.pdf",
          type: "application/pdf",
          disposition: "attachment",
        },
      ],
    });
  });

  it("adds text, cc and threading headers when given", () => {
    const payload = buildCloudflarePayload({
      ...message,
      attachments: undefined,
      text: "Hola",
      cc: ["b@example.com"],
      headers: { "In-Reply-To": "<m1@x>", References: "<m0@x> <m1@x>" },
    });
    expect(payload).toMatchObject({
      text: "Hola",
      cc: ["b@example.com"],
      headers: { "In-Reply-To": "<m1@x>", References: "<m0@x> <m1@x>" },
    });
    expect(payload).not.toHaveProperty("attachments");
  });

  it("posts to the account's send endpoint with a bearer token", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        success: true,
        errors: [],
        messages: [],
        result: { delivered: ["cliente@example.com"], permanent_bounces: [], queued: [] },
      }),
    );
    const provider = createCloudflareProvider({ accountId: "acc123", apiToken: "tok", fetchImpl });
    await expect(provider.send(message)).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/email/sending/send");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual(
      JSON.parse(JSON.stringify(buildCloudflarePayload(message))),
    );
  });

  it("reports a rejection without throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () =>
      Response.json(
        {
          success: false,
          errors: [{ code: 10001, message: "email.sending.error.invalid_request_schema" }],
          messages: [],
          result: null,
        },
        { status: 400 },
      ),
    );
    const provider = createCloudflareProvider({ accountId: "a", apiToken: "t", fetchImpl });
    await expect(provider.send(message)).resolves.toEqual({ ok: false });
    error.mockRestore();
  });

  it("treats a permanent bounce as a failed send", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () =>
      Response.json({
        success: true,
        errors: [],
        messages: [],
        result: { delivered: [], permanent_bounces: ["cliente@example.com"], queued: [] },
      }),
    );
    const provider = createCloudflareProvider({ accountId: "a", apiToken: "t", fetchImpl });
    await expect(provider.send(message)).resolves.toEqual({ ok: false });
    error.mockRestore();
  });
});
