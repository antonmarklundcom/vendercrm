import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// verifySignature itself needs no DB, but the module it lives in
// transitively imports lib/config/env (which validates the *whole* env,
// DATABASE_URL included) — same reason the isolation suites gate on hasDb
// and dynamic-import, see modules/tenancy/isolation.test.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("whatsapp webhook signature verification", () => {
  let verifySignature: (typeof import("./webhook"))["verifySignature"];

  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";

  it("accepts a signature computed with the configured app secret", async () => {
    ({ verifySignature } = await import("./webhook"));
    const body = JSON.stringify({ hello: "world" });
    const signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;

    expect(verifySignature(body, signature)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    ({ verifySignature } = await import("./webhook"));
    const body = JSON.stringify({ hello: "world" });
    const signature = `sha256=${createHmac("sha256", "wrong-secret").update(body).digest("hex")}`;

    expect(verifySignature(body, signature)).toBe(false);
  });

  it("rejects a signature computed over a different body (tamper detection)", async () => {
    ({ verifySignature } = await import("./webhook"));
    const signature = `sha256=${createHmac("sha256", appSecret).update("original").digest("hex")}`;

    expect(verifySignature("tampered", signature)).toBe(false);
  });

  it("rejects a missing or malformed header", async () => {
    ({ verifySignature } = await import("./webhook"));
    expect(verifySignature("body", null)).toBe(false);
    expect(verifySignature("body", "not-sha256=abc")).toBe(false);
  });
});

describe.skipIf(!hasDb)("validateInboundMedia", () => {
  it("accepts a mime type and size within the type's Meta-documented cap", async () => {
    const { validateInboundMedia } = await import("./webhook");
    expect(validateInboundMedia("image", "image/jpeg", 4 * 1024 * 1024)).toEqual({ ok: true });
    expect(validateInboundMedia("document", "application/pdf", 50 * 1024 * 1024)).toEqual({
      ok: true,
    });
  });

  it("rejects a disallowed MIME type even under the size cap", async () => {
    const { validateInboundMedia } = await import("./webhook");
    const result = validateInboundMedia("image", "application/x-msdownload", 1024);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing MIME type", async () => {
    const { validateInboundMedia } = await import("./webhook");
    const result = validateInboundMedia("video", undefined, 1024);
    expect(result.ok).toBe(false);
  });

  it("rejects a file over the type's cap even with an allowed MIME type", async () => {
    const { validateInboundMedia } = await import("./webhook");
    const result = validateInboundMedia("image", "image/jpeg", 6 * 1024 * 1024);
    expect(result.ok).toBe(false);
  });
});

describe.skipIf(!hasDb)("downloadMedia", () => {
  const account = {
    tenantId: "tenant-1",
    accessTokenCiphertext: "c",
    accessTokenIv: "i",
    accessTokenTag: "t",
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock("./accounts");
    vi.doUnmock("@/lib/storage");
    vi.resetModules();
  });

  it("rejects oversized media without writing it to storage", async () => {
    vi.doMock("./accounts", async () => {
      const actual = await vi.importActual<typeof import("./accounts")>("./accounts");
      return { ...actual, getDecryptedAccessToken: () => "token" };
    });
    const put = vi.fn();
    vi.doMock("@/lib/storage", () => ({ storage: { put, get: vi.fn(), getSignedUrl: vi.fn(), delete: vi.fn() } }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/media-id-1")) {
          return new Response(
            JSON.stringify({ url: "https://example.com/file", mime_type: "image/jpeg", file_size: 6 * 1024 * 1024 }),
            { status: 200 },
          );
        }
        return new Response(Buffer.alloc(6 * 1024 * 1024), { status: 200 });
      }),
    );

    const { downloadMedia } = await import("./webhook");
    await expect(downloadMedia(account as never, "media-id-1", "image")).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a disallowed MIME type without writing it to storage", async () => {
    vi.doMock("./accounts", async () => {
      const actual = await vi.importActual<typeof import("./accounts")>("./accounts");
      return { ...actual, getDecryptedAccessToken: () => "token" };
    });
    const put = vi.fn();
    vi.doMock("@/lib/storage", () => ({ storage: { put, get: vi.fn(), getSignedUrl: vi.fn(), delete: vi.fn() } }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/media-id-2")) {
          return new Response(
            JSON.stringify({ url: "https://example.com/file", mime_type: "application/zip", file_size: 1024 }),
            { status: 200 },
          );
        }
        return new Response(Buffer.alloc(1024), { status: 200 });
      }),
    );

    const { downloadMedia } = await import("./webhook");
    await expect(downloadMedia(account as never, "media-id-2", "document")).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("downloads and stores media within limits and of an allowed type", async () => {
    vi.doMock("./accounts", async () => {
      const actual = await vi.importActual<typeof import("./accounts")>("./accounts");
      return { ...actual, getDecryptedAccessToken: () => "token" };
    });
    const put = vi.fn();
    vi.doMock("@/lib/storage", () => ({ storage: { put, get: vi.fn(), getSignedUrl: vi.fn(), delete: vi.fn() } }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/media-id-3")) {
          return new Response(
            JSON.stringify({ url: "https://example.com/file", mime_type: "image/jpeg", file_size: 1024 }),
            { status: 200 },
          );
        }
        return new Response(Buffer.alloc(1024), { status: 200 });
      }),
    );

    const { downloadMedia } = await import("./webhook");
    const result = await downloadMedia(account as never, "media-id-3", "image");
    expect(result).toEqual({ key: "whatsapp-media/tenant-1/media-id-3", mimeType: "image/jpeg" });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(
      "whatsapp-media/tenant-1/media-id-3",
      expect.any(Buffer),
      "image/jpeg",
    );
  });
});
