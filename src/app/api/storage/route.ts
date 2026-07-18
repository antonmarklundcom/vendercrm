import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { verifyLocalSignature } from "@/lib/storage/local";
import { storage } from "@/lib/storage";

// Serves files for the local storage driver's signed URLs (PLAN.md §2.1). Only
// wired up for STORAGE_DRIVER=local — the S3 driver returns real presigned
// URLs that bypass this route entirely.
export async function GET(req: NextRequest) {
  if (env.STORAGE_DRIVER !== "local") {
    return new NextResponse("Not found", { status: 404 });
  }

  const params = req.nextUrl.searchParams;
  const key = params.get("key");
  const expires = Number(params.get("expires"));
  const sig = params.get("sig");

  if (!key || !sig || !Number.isFinite(expires)) {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (!verifyLocalSignature(key, expires, sig)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const bytes = await storage.get(key);
    const contentType = key.endsWith(".pdf")
      ? "application/pdf"
      : "application/octet-stream";
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
