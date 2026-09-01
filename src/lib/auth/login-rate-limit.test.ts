import { describe, expect, it } from "vitest";
import { checkLoginAttempt, isGuardedAuthPath } from "./login-rate-limit";

describe("isGuardedAuthPath", () => {
  it("covers the credential and password-reset endpoints", () => {
    expect(isGuardedAuthPath("/api/auth/sign-in/email")).toBe(true);
    expect(isGuardedAuthPath("/api/auth/forget-password")).toBe(true);
    expect(isGuardedAuthPath("/api/auth/reset-password")).toBe(true);
  });

  it("leaves the rest of Better Auth alone", () => {
    expect(isGuardedAuthPath("/api/auth/get-session")).toBe(false);
    expect(isGuardedAuthPath("/api/auth/sign-out")).toBe(false);
  });
});

describe("checkLoginAttempt", () => {
  it("blocks repeated attempts against one email", async () => {
    const email = `victim-${Math.random()}@example.com`;
    for (let i = 0; i < 6; i++) {
      expect(await checkLoginAttempt({ ip: `ip-${Math.random()}`, email })).toBe(false);
    }
    expect(await checkLoginAttempt({ ip: `ip-${Math.random()}`, email })).toBe(true);
  });

  it("blocks one IP spraying many emails", async () => {
    const ip = `spray-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      expect(
        await checkLoginAttempt({ ip, email: `user-${i}-${Math.random()}@example.com` }),
      ).toBe(false);
    }
    expect(await checkLoginAttempt({ ip, email: `user-last-${Math.random()}@example.com` })).toBe(
      true,
    );
  });
});
