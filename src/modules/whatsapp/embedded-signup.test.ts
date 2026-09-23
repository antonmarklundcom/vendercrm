import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The server half of Meta Embedded Signup, with Graph faked at `fetch` and
// the wa_accounts write faked at the module boundary. What these pin is the
// ordering promise in embedded-signup.ts: every failure before the last
// Graph call leaves nothing stored, and each failure comes back as its own
// error key instead of a thrown exception.

vi.mock("@/lib/config/env", () => ({
  env: {
    WHATSAPP_GRAPH_API_VERSION: "v21.0",
    WHATSAPP_APP_SECRET: "app-secret-for-tests",
    META_APP_ID: "1111",
    META_EMBEDDED_SIGNUP_CONFIG_ID: "2222",
  },
}));

const resolveAccountByPhoneNumberId = vi.fn();
const storeConnectedAccount = vi.fn();
vi.mock("./accounts", () => ({
  resolveAccountByPhoneNumberId: (...args: unknown[]) => resolveAccountByPhoneNumberId(...args),
  storeConnectedAccount: (...args: unknown[]) => storeConnectedAccount(...args),
}));

const { completeEmbeddedSignup, embeddedSignupClientConfig, generateRegistrationPin } =
  await import("./embedded-signup");

const ctx = {
  tenantId: "tenant-1",
  userId: "user-1",
  role: "admin" as const,
  impersonatorUserId: null,
  accessStatus: "active" as const,
};

type Route = { match: (url: URL, init?: RequestInit) => boolean; respond: () => Response };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const calls: { url: URL; init?: RequestInit }[] = [];

function mockGraph(overrides: Partial<Record<"token" | "phones" | "subscribe" | "register", () => Response>> = {}) {
  const routes: Route[] = [
    {
      match: (url) => url.pathname === "/v21.0/oauth/access_token",
      respond: overrides.token ?? (() => json({ access_token: "business-token", token_type: "bearer" })),
    },
    {
      match: (url) => url.pathname === "/v21.0/555/phone_numbers",
      respond:
        overrides.phones ??
        (() => json({ data: [{ id: "777", display_phone_number: "+595 981 123456", verified_name: "Acme" }] })),
    },
    {
      match: (url, init) => url.pathname === "/v21.0/555/subscribed_apps" && init?.method === "POST",
      respond: overrides.subscribe ?? (() => json({ success: true })),
    },
    {
      match: (url, init) => url.pathname === "/v21.0/777/register" && init?.method === "POST",
      respond: overrides.register ?? (() => json({ success: true })),
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      calls.push({ url, init });
      const route = routes.find((r) => r.match(url, init));
      if (!route) throw new Error(`unexpected Graph call ${init?.method ?? "GET"} ${url}`);
      return route.respond();
    }),
  );
}

function called(pathname: string) {
  return calls.filter((c) => c.url.pathname === pathname);
}

beforeEach(() => {
  calls.length = 0;
  resolveAccountByPhoneNumberId.mockResolvedValue(null);
  storeConnectedAccount.mockResolvedValue({ id: "acc-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resolveAccountByPhoneNumberId.mockReset();
  storeConnectedAccount.mockReset();
});

describe("embeddedSignupClientConfig", () => {
  it("exposes the public ids and graph version, never the secret", () => {
    const config = embeddedSignupClientConfig();
    expect(config).toEqual({ appId: "1111", configId: "2222", graphVersion: "v21.0" });
    expect(JSON.stringify(config)).not.toContain("app-secret-for-tests");
  });
});

describe("completeEmbeddedSignup", () => {
  const input = { code: "the-code", wabaId: "555", phoneNumberId: "777", mode: "cloud_api" as const };

  it("exchanges, subscribes, registers and stores an embedded account", async () => {
    mockGraph();
    const result = await completeEmbeddedSignup(ctx, input);

    expect(result).toEqual({ ok: true, accountId: "acc-1", wabaId: "555", phoneNumberId: "777" });

    const [exchange] = called("/v21.0/oauth/access_token");
    expect(exchange!.url.searchParams.get("client_id")).toBe("1111");
    expect(exchange!.url.searchParams.get("client_secret")).toBe("app-secret-for-tests");
    expect(exchange!.url.searchParams.get("code")).toBe("the-code");

    const [subscribe] = called("/v21.0/555/subscribed_apps");
    expect(new Headers(subscribe!.init?.headers).get("Authorization")).toBe("Bearer business-token");

    const [register] = called("/v21.0/777/register");
    const body = JSON.parse(String(register!.init?.body));
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.pin).toMatch(/^\d{6}$/);

    expect(storeConnectedAccount).toHaveBeenCalledTimes(1);
    const [storeCtx, stored] = storeConnectedAccount.mock.calls[0]!;
    expect(storeCtx).toBe(ctx);
    expect(stored).toMatchObject({
      wabaId: "555",
      phoneNumberId: "777",
      displayNumber: "+595 981 123456",
      verifiedName: "Acme",
      accessToken: "business-token",
      connectedVia: "embedded",
    });
    expect(stored.webhookSubscribedAt).toBeInstanceOf(Date);
  });

  it("does not register a coexistence number, and finds it from the WABA when the event has no id", async () => {
    mockGraph();
    const result = await completeEmbeddedSignup(ctx, {
      code: "the-code",
      wabaId: "555",
      mode: "coexistence",
    });

    expect(result).toMatchObject({ ok: true, phoneNumberId: "777" });
    expect(called("/v21.0/555/subscribed_apps")).toHaveLength(1);
    expect(called("/v21.0/777/register")).toHaveLength(0);
    expect(storeConnectedAccount).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad code before touching anything else", async () => {
    mockGraph({
      token: () => json({ error: { message: "Invalid verification code format.", code: 100 } }, 400),
    });
    const result = await completeEmbeddedSignup(ctx, input);

    expect(result).toEqual({ ok: false, error: "codeExchangeFailed" });
    expect(calls).toHaveLength(1);
    expect(storeConnectedAccount).not.toHaveBeenCalled();
  });

  it("stores nothing when the webhook subscription fails", async () => {
    mockGraph({
      subscribe: () => json({ error: { message: "Permissions error", code: 200 } }, 403),
    });
    const result = await completeEmbeddedSignup(ctx, input);

    expect(result).toEqual({ ok: false, error: "subscribeFailed" });
    expect(called("/v21.0/777/register")).toHaveLength(0);
    expect(storeConnectedAccount).not.toHaveBeenCalled();
  });

  it("stores nothing when registration fails", async () => {
    mockGraph({
      register: () => json({ error: { message: "Two step verification PIN mismatch", code: 133005 } }, 400),
    });
    const result = await completeEmbeddedSignup(ctx, input);

    expect(result).toEqual({ ok: false, error: "registerFailed" });
    expect(storeConnectedAccount).not.toHaveBeenCalled();
  });

  it("refuses a phone number id that is not in the granted WABA", async () => {
    mockGraph();
    const result = await completeEmbeddedSignup(ctx, { ...input, phoneNumberId: "999" });

    expect(result).toEqual({ ok: false, error: "phoneNumberNotFound" });
    expect(called("/v21.0/555/subscribed_apps")).toHaveLength(0);
    expect(storeConnectedAccount).not.toHaveBeenCalled();
  });

  it("refuses to guess between several numbers when coexistence sent no id", async () => {
    mockGraph({ phones: () => json({ data: [{ id: "777" }, { id: "778" }] }) });
    const result = await completeEmbeddedSignup(ctx, { code: "c", wabaId: "555", mode: "coexistence" });

    expect(result).toEqual({ ok: false, error: "phoneNumberNotFound" });
    expect(called("/v21.0/555/subscribed_apps")).toHaveLength(0);
  });

  it("refuses a number already connected before changing anything at Meta", async () => {
    mockGraph();
    resolveAccountByPhoneNumberId.mockResolvedValue({ id: "existing" });
    const result = await completeEmbeddedSignup(ctx, input);

    expect(result).toEqual({ ok: false, error: "numberAlreadyConnected" });
    expect(called("/v21.0/555/subscribed_apps")).toHaveLength(0);
    expect(called("/v21.0/777/register")).toHaveLength(0);
  });

  it("reports a failed store without leaking the error", async () => {
    mockGraph();
    storeConnectedAccount.mockRejectedValue(new Error("Failed query: insert ... params: secret"));
    const result = await completeEmbeddedSignup(ctx, input);

    expect(result).toEqual({ ok: false, error: "storeFailed" });
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).not.toContain("params");
  });

  it("never logs the token, the code or the app secret", async () => {
    mockGraph({ register: () => json({ error: { message: "nope", code: 1 } }, 500) });
    await completeEmbeddedSignup(ctx, input);
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("phone registration");
    expect(logged).not.toContain("business-token");
    expect(logged).not.toContain("the-code");
    expect(logged).not.toContain("app-secret-for-tests");
  });
});

describe("generateRegistrationPin", () => {
  it("is always six digits", () => {
    for (let i = 0; i < 200; i++) expect(generateRegistrationPin()).toMatch(/^[1-9]\d{5}$/);
  });
});
