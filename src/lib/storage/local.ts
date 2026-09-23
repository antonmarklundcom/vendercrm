import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { env } from "@/lib/config/env";
import type { StorageAdapter } from "./types";

// Bootstrap driver — Hostinger disk is non-durable, so this is meant to be
// swapped for the S3-compatible driver before onboarding external tenants
// (PLAN.md §2.1). Signed URLs are HMAC query tokens verified by whichever
// route serves the file (added alongside the module that needs it, e.g. 1D
// WhatsApp media) — this adapter only issues/validates the token.

const root = resolve(env.STORAGE_LOCAL_PATH);

function resolveKeyPath(key: string): string {
  const path = normalize(join(root, key));
  if (!path.startsWith(root)) {
    throw new Error(`Storage key escapes root: ${key}`);
  }
  return path;
}

// Same escape guard as resolveKeyPath, plus two rules specific to deleting a
// whole subtree: the result must be a strict descendant of root (an empty or
// "." prefix would otherwise `rm -rf` every tenant's files at once), and it
// is resolved without ever being handed to a single unguarded `rm`.
function resolvePrefixPath(prefix: string): string {
  const path = normalize(join(root, prefix));
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`Storage prefix escapes root: ${prefix}`);
  }
  if (path === root) {
    throw new Error(`Refusing to delete the whole storage root: ${prefix}`);
  }
  return path;
}

// put()'s contentType has no filesystem home of its own, and keys like
// whatsapp-media/<tenantId>/<mediaId> carry no extension to guess it back
// from — so it rides alongside the object in a sidecar file the serving
// route reads. Missing sidecar (object written before this existed) just
// means the route falls back to a generic content type.
function contentTypePath(key: string): string {
  return `${resolveKeyPath(key)}.contenttype`;
}

export async function getLocalContentType(key: string): Promise<string | undefined> {
  try {
    return (await readFile(contentTypePath(key), "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function signLocalKey(key: string, expiresAt: number): string {
  return createHmac("sha256", env.APP_ENCRYPTION_KEY)
    .update(`${key}:${expiresAt}`)
    .digest("hex");
}

export function verifyLocalSignature(
  key: string,
  expiresAt: number,
  signature: string,
): boolean {
  if (Date.now() > expiresAt) return false;
  const expected = Buffer.from(signLocalKey(key, expiresAt));
  const actual = Buffer.from(signature);
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

export const localStorage: StorageAdapter = {
  async put(key, data, contentType) {
    const path = resolveKeyPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    if (contentType) {
      await writeFile(contentTypePath(key), contentType, "utf8");
    }
  },

  async get(key) {
    return readFile(resolveKeyPath(key));
  },

  async getSignedUrl(key, expiresInSeconds = 3600) {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const signature = signLocalKey(key, expiresAt);
    const params = new URLSearchParams({
      key,
      expires: String(expiresAt),
      sig: signature,
    });
    return `/api/storage?${params.toString()}`;
  },

  async delete(key) {
    await rm(resolveKeyPath(key), { force: true });
    await rm(contentTypePath(key), { force: true });
  },

  async deletePrefix(prefix) {
    const path = resolvePrefixPath(prefix);
    let deleted = 0;
    try {
      // Counted before the rm, and sidecar `.contenttype` files excluded —
      // they ride along with the object they describe, not a second object.
      const entries = await readdir(path, { recursive: true, withFileTypes: true });
      deleted = entries.filter((e) => e.isFile() && !e.name.endsWith(".contenttype")).length;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { deleted: 0, failed: 0 };
      }
      return { deleted: 0, failed: 1 };
    }
    try {
      await rm(path, { recursive: true, force: true });
      return { deleted, failed: 0 };
    } catch {
      return { deleted: 0, failed: deleted || 1 };
    }
  },
};
