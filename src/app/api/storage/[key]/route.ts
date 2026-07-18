import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { verifySignedKey } from "@/lib/storage/local";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key: encodedKey } = await params;
  const key = decodeURIComponent(encodedKey);
  const exp = Number(request.nextUrl.searchParams.get("exp"));
  const sig = request.nextUrl.searchParams.get("sig");

  if (!sig || !Number.isFinite(exp) || !verifySignedKey(key, exp, sig)) {
    return NextResponse.json({ error: "Invalid or expired URL" }, { status: 403 });
  }

  try {
    const data = await storage.get(key);
    return new NextResponse(new Uint8Array(data));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
