import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/env", () => ({ env: {} }));

const { formatTelegramText, isStopCommand, parseStartToken, telegramDeepLink } = await import(
  "./telegram"
);

describe("parseStartToken", () => {
  it("reads the token the deep link sends", () => {
    expect(parseStartToken("/start abcdefghijklmnop_1234")).toBe("abcdefghijklmnop_1234");
    expect(parseStartToken("/start@clientes_bot abcdefghijklmnop")).toBe("abcdefghijklmnop");
  });

  it("ignores a bare /start, short tokens and other text", () => {
    expect(parseStartToken("/start")).toBeNull();
    expect(parseStartToken("/start abc")).toBeNull();
    expect(parseStartToken("hola")).toBeNull();
    expect(parseStartToken(undefined)).toBeNull();
  });
});

describe("isStopCommand", () => {
  it("matches /stop only", () => {
    expect(isStopCommand("/stop")).toBe(true);
    expect(isStopCommand("/stop@clientes_bot")).toBe(true);
    expect(isStopCommand("/stopper")).toBe(false);
  });
});

describe("formatTelegramText", () => {
  it("escapes customer text and links back into the CRM", () => {
    const text = formatTelegramText(
      { title: "Nuevo mensaje de <Ana>", body: "¿Precio & envío?", url: "/inbox/c1" },
      "https://crm.clientes.com.py",
    );
    expect(text).toBe(
      '<b>Nuevo mensaje de &lt;Ana&gt;</b>\n¿Precio &amp; envío?\n<a href="https://crm.clientes.com.py/inbox/c1">Abrir en el CRM</a>',
    );
  });

  it("cuts a very long body", () => {
    const text = formatTelegramText({ title: "x", body: "a".repeat(5000) }, "https://x.test");
    expect(text.length).toBeLessThan(1100);
  });
});

describe("telegramDeepLink", () => {
  it("builds the t.me start link", () => {
    expect(telegramDeepLink("clientes_bot", "tok_123")).toBe(
      "https://t.me/clientes_bot?start=tok_123",
    );
  });
});
