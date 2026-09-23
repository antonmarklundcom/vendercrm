import { beforeEach, describe, expect, it, vi } from "vitest";

// deletePrefix's batching against a mocked S3 client — no bucket needed.
// list/delete are exercised for the two things a real bug here would get
// wrong silently: paging past 1000 listed keys, and chunking past 1000
// deleted keys (S3's own per-call cap on DeleteObjects), independently of
// each other.

const send = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class FakeCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    // A plain function, not an arrow: the driver instantiates this with
    // `new`, which an arrow function can't be.
    S3Client: vi.fn().mockImplementation(function S3Client() {
      return { send };
    }),
    ListObjectsV2Command: class extends FakeCommand {},
    DeleteObjectsCommand: class extends FakeCommand {},
    DeleteObjectCommand: class extends FakeCommand {},
    GetObjectCommand: class extends FakeCommand {},
    PutObjectCommand: class extends FakeCommand {},
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  env: {
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    S3_REGION: "auto",
    S3_BUCKET: "test-bucket",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
  },
}));

function keysOf(command: { input: unknown }): string[] {
  const input = command.input as { Prefix?: string; Delete?: { Objects: { Key: string }[] } };
  if (input.Delete) return input.Delete.Objects.map((o) => o.Key);
  return [];
}

describe("s3Storage.deletePrefix", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("deletes every listed key in one batch when there are fewer than 1000", async () => {
    const { s3Storage } = await import("./s3");
    const keys = Array.from({ length: 3 }, (_, i) => `whatsapp-media/tenant-1/m${i}`);

    send.mockImplementation(async (command: { input: unknown }) => {
      if ("Prefix" in (command.input as object)) {
        return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
      }
      return { Errors: [] };
    });

    const result = await s3Storage.deletePrefix("whatsapp-media/tenant-1/");

    expect(result).toEqual({ deleted: 3, failed: 0 });
    const deleteCalls = send.mock.calls.filter(([c]) => keysOf(c).length > 0);
    expect(deleteCalls).toHaveLength(1);
    expect(keysOf(deleteCalls[0][0])).toEqual(keys);
  });

  it("pages past a truncated listing and chunks deletes at 1000 keys per call", async () => {
    const { s3Storage } = await import("./s3");
    const pageOne = Array.from({ length: 1000 }, (_, i) => `quotes/tenant-2/a${i}`);
    const pageTwo = Array.from({ length: 500 }, (_, i) => `quotes/tenant-2/b${i}`);

    let listCall = 0;
    send.mockImplementation(async (command: { input: unknown }) => {
      const input = command.input as { Prefix?: string; Delete?: unknown };
      if (input.Prefix !== undefined) {
        listCall += 1;
        return listCall === 1
          ? { Contents: pageOne.map((Key) => ({ Key })), IsTruncated: true, NextContinuationToken: "tok" }
          : { Contents: pageTwo.map((Key) => ({ Key })), IsTruncated: false };
      }
      return { Errors: [] };
    });

    const result = await s3Storage.deletePrefix("quotes/tenant-2/");

    expect(result).toEqual({ deleted: 1500, failed: 0 });
    const deleteCalls = send.mock.calls.filter(([c]) => keysOf(c).length > 0);
    // 1000 from page one in its own batch, plus 500 from page two — three
    // DeleteObjects calls in total (1000, then 1000 capped to what's left).
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0][0].input.Delete.Objects).toHaveLength(1000);
    expect(deleteCalls[1][0].input.Delete.Objects).toHaveLength(500);
  });

  it("counts per-object errors as failed without throwing", async () => {
    const { s3Storage } = await import("./s3");
    const keys = ["documents/tenant-3/a", "documents/tenant-3/b"];

    send.mockImplementation(async (command: { input: unknown }) => {
      if ("Prefix" in (command.input as object)) {
        return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
      }
      return { Errors: [{ Key: "documents/tenant-3/b", Code: "AccessDenied" }] };
    });

    const result = await s3Storage.deletePrefix("documents/tenant-3/");
    expect(result).toEqual({ deleted: 1, failed: 1 });
  });

  it("is a no-op for a prefix with nothing listed", async () => {
    const { s3Storage } = await import("./s3");
    send.mockResolvedValue({ Contents: [], IsTruncated: false });

    const result = await s3Storage.deletePrefix("quotes/tenant-empty/");
    expect(result).toEqual({ deleted: 0, failed: 0 });
    expect(send.mock.calls.filter(([c]) => keysOf(c).length > 0)).toHaveLength(0);
  });
});
