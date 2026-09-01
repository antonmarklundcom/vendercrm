import { env } from "@/lib/config/env";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLocalContentType, verifyLocalSignature } from "@/lib/storage/local";
import { classifySignedUrl } from "@/lib/storage/signed-url";
import { storage } from "@/lib/storage";

/**
 * Per-IP allowance, deliberately looser than /q/[token]/pdf's 30/60s: one
 * WhatsApp conversation view or quote page pulls a whole batch of attachments
 * at once, and Meta fetches media URLs itself, so a legitimate burst here is
 * many requests, not one. High enough that no real client trips it; low
 * enough that brute-forcing signatures is pointless.
 */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

// Serves the local driver's signed URLs (see lib/storage/local.ts). Same
// capability model as the public quote view /q/[token] (§8): the signature
// in the query string IS the auth — unguessable + expiring, no session or
// tenant check here, by design. The S3 driver never points here; its
// presigned URLs are absolute and fetched straight from the bucket.
export async function GET(request: Request) {
  // Before the signature check, not after: what is worth throttling is a
  // flood of *guesses*, and those never reach the serving path. Same key
  // shape as /q/[token]/pdf — the caller's address per lib/http/client-ip,
  // with its own namespace so the two routes can't share a bucket.
  const ip = clientIp(request.headers);
  if ((await checkRateLimit(`storage:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)).limited) {
    return new Response("Too many requests", { status: 429 });
  }

  if (env.STORAGE_DRIVER !== "local") {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const classified = classifySignedUrl(`${url.pathname}${url.search}`);

  // Every failure mode below — bad params, forged sig, expired token, missing
  // object — returns the same 404 so the route never reveals which keys
  // exist or why a given URL didn't work.
  if (classified.kind !== "appRelative") {
    return new Response("Not found", { status: 404 });
  }

  const { key, expiresAt, signature } = classified;
  if (!verifyLocalSignature(key, expiresAt, signature)) {
    return new Response("Not found", { status: 404 });
  }

  let data: Buffer;
  try {
    data = await storage.get(key);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const contentType = (await getLocalContentType(key)) ?? "application/octet-stream";

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
    },
  });
}
