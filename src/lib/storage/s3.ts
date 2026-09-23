import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/config/env";
import type { StorageAdapter } from "./types";

// S3-compatible driver (PLAN.md §10 1K). Written against Cloudflare R2 —
// free egress and full S3 API compatibility, so this is the same client the
// AWS SDK ships for S3 itself, pointed at R2's endpoint. Any other
// S3-compatible provider (MinIO, Backblaze B2's S3 gateway) works too by
// changing the endpoint.
//
// This replaces Hostinger local disk, which §2.1 documents as non-durable —
// quote PDFs and inbound WhatsApp media are the two things that must survive
// a container rebuild.

function client(): S3Client {
  // Validated present by env.ts's superRefine whenever STORAGE_DRIVER=s3, so
  // these reads are safe — the non-null assertions document that contract
  // rather than re-deriving it.
  return new S3Client({
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // The SDK's response body type differs between Node and edge runtimes;
  // this app only ever runs the S3 driver from Node (serverExternalPackages
  // in next.config.ts already excludes storage from the edge bundle), so a
  // Node.Readable is the only shape to handle.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const s3Storage: StorageAdapter = {
  async put(key, data, contentType) {
    await client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET!,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  },

  async get(key) {
    const result = await client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }),
    );
    if (!result.Body) throw new Error(`Storage key not found: ${key}`);
    return streamToBuffer(result.Body);
  },

  async getSignedUrl(key, expiresInSeconds = 3600) {
    return getSignedUrl(
      client(),
      new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  },

  async delete(key) {
    await client().send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }),
    );
  },

  async deletePrefix(prefix) {
    const s3 = client();
    const bucket = env.S3_BUCKET!;
    let deleted = 0;
    let failed = 0;
    let ContinuationToken: string | undefined;

    do {
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));

      // DeleteObjects caps at 1000 keys per call regardless of how many a
      // single ListObjectsV2 page returned (it can't exceed that either, but
      // chunking here keeps the two limits independent of each other).
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        const result = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        const batchFailed = result.Errors?.length ?? 0;
        failed += batchFailed;
        deleted += batch.length - batchFailed;
      }

      ContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (ContinuationToken);

    return { deleted, failed };
  },
};
