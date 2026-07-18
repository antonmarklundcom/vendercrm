import { createHmac, timingSafeEqual } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join, normalize, resolve, sep } from "path";
import { env } from "@/lib/config/env";
import type { StorageDriver } from "./types";

const rootDir = resolve(env.STORAGE_LOCAL_PATH);

function resolveSafePath(key: string): string {
  const target = normalize(join(rootDir, key));

  if (target !== rootDir && !target.startsWith(rootDir + sep)) {
    throw new Error(`Storage key escapes storage root: ${key}`);
  }

  return target;
}

function sign(key: string, expiresAt: number): string {
  return createHmac("sha256", Buffer.from(env.APP_ENCRYPTION_KEY, "hex"))
    .update(`${key}:${expiresAt}`)
    .digest("base64url");
}

export function verifySignedKey(
  key: string,
  expiresAt: number,
  signature: string,
): boolean {
  if (Date.now() > expiresAt) return false;

  const expected = sign(key, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  return a.length === b.length && timingSafeEqual(a, b);
}

export const localStorageDriver: StorageDriver = {
  async put(key, data) {
    const path = resolveSafePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  },

  async get(key) {
    return readFile(resolveSafePath(key));
  },

  async getSignedUrl(key, expiresInSeconds = 3600) {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const signature = sign(key, expiresAt);
    const params = new URLSearchParams({
      exp: String(expiresAt),
      sig: signature,
    });

    return `${env.APP_BASE_URL}/api/storage/${encodeURIComponent(key)}?${params.toString()}`;
  },

  async delete(key) {
    await rm(resolveSafePath(key), { force: true });
  },
};
