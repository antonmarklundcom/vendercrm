import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Guarded like the other module suites that import env (settings.test.ts):
// local.ts reads env.APP_ENCRYPTION_KEY and env.STORAGE_LOCAL_PATH at import
// time via the shared env module, which also requires DATABASE_URL etc.
const hasEnv = !!process.env.APP_ENCRYPTION_KEY && !!process.env.DATABASE_URL;

describe.skipIf(!hasEnv)("local storage driver", () => {
  let local: typeof import("./local");
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "vendercrm-storage-"));
    process.env.STORAGE_LOCAL_PATH = storageDir;
    local = await import("./local");
  });

  afterAll(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  describe("signLocalKey / verifyLocalSignature", () => {
    it("accepts its own signature", () => {
      const expiresAt = Date.now() + 60_000;
      const sig = local.signLocalKey("a/b.txt", expiresAt);
      expect(local.verifyLocalSignature("a/b.txt", expiresAt, sig)).toBe(true);
    });

    it("rejects a tampered signature", () => {
      const expiresAt = Date.now() + 60_000;
      const sig = local.signLocalKey("a/b.txt", expiresAt);
      expect(local.verifyLocalSignature("a/b.txt", expiresAt, `${sig}00`)).toBe(false);
    });

    it("rejects a signature issued for a different key", () => {
      const expiresAt = Date.now() + 60_000;
      const sig = local.signLocalKey("a/b.txt", expiresAt);
      expect(local.verifyLocalSignature("a/other.txt", expiresAt, sig)).toBe(false);
    });

    it("rejects an expired token even with a valid signature", () => {
      const expiresAt = Date.now() - 1000;
      const sig = local.signLocalKey("a/b.txt", expiresAt);
      expect(local.verifyLocalSignature("a/b.txt", expiresAt, sig)).toBe(false);
    });
  });

  describe("content type sidecar", () => {
    it("round-trips the content type given to put()", async () => {
      const key = "ct-test/with-type.bin";
      await local.localStorage.put(key, Buffer.from("hi"), "image/png");
      expect(await local.getLocalContentType(key)).toBe("image/png");
    });

    it("is undefined when put() was called without a content type", async () => {
      const key = "ct-test/without-type.bin";
      await local.localStorage.put(key, Buffer.from("hi"));
      expect(await local.getLocalContentType(key)).toBeUndefined();
    });

    it("is undefined for a key that was never written", async () => {
      expect(await local.getLocalContentType("ct-test/never-written.bin")).toBeUndefined();
    });

    it("is gone after delete()", async () => {
      const key = "ct-test/deleted.bin";
      await local.localStorage.put(key, Buffer.from("hi"), "text/plain");
      await local.localStorage.delete(key);
      expect(await local.getLocalContentType(key)).toBeUndefined();
    });
  });

  describe("deletePrefix", () => {
    it("removes every object under the prefix, counting objects but not their sidecar files", async () => {
      const tenantId = "tenant-prefix-a";
      await local.localStorage.put(`quotes/${tenantId}/a.pdf`, Buffer.from("1"), "application/pdf");
      await local.localStorage.put(`quotes/${tenantId}/b.pdf`, Buffer.from("2"), "application/pdf");

      const result = await local.localStorage.deletePrefix(`quotes/${tenantId}/`);
      expect(result).toEqual({ deleted: 2, failed: 0 });

      await expect(local.localStorage.get(`quotes/${tenantId}/a.pdf`)).rejects.toThrow();
      await expect(local.localStorage.get(`quotes/${tenantId}/b.pdf`)).rejects.toThrow();
    });

    it("leaves a different tenant's objects under the same kind untouched", async () => {
      const a = "tenant-prefix-b1";
      const b = "tenant-prefix-b2";
      await local.localStorage.put(`documents/${a}/x.pdf`, Buffer.from("mine"), "application/pdf");
      await local.localStorage.put(`documents/${b}/x.pdf`, Buffer.from("theirs"), "application/pdf");

      await local.localStorage.deletePrefix(`documents/${a}/`);

      await expect(local.localStorage.get(`documents/${a}/x.pdf`)).rejects.toThrow();
      expect(await local.localStorage.get(`documents/${b}/x.pdf`)).toEqual(Buffer.from("theirs"));
    });

    it("is a no-op, not a failure, for a prefix that was never written", async () => {
      expect(await local.localStorage.deletePrefix("quotes/never-existed/")).toEqual({
        deleted: 0,
        failed: 0,
      });
    });

    it("refuses a prefix that would delete the whole storage root", async () => {
      await expect(local.localStorage.deletePrefix("")).rejects.toThrow(/whole storage root/);
      await expect(local.localStorage.deletePrefix(".")).rejects.toThrow(/whole storage root/);
    });

    it("refuses a prefix that escapes the storage root", async () => {
      await expect(local.localStorage.deletePrefix("../")).rejects.toThrow(/escapes root/);
    });
  });
});
