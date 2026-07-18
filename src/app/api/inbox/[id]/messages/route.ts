import { NextResponse } from "next/server";
import { getTenantContext } from "@/modules/tenancy/context";
import { getConversationMessages } from "@/modules/whatsapp/queries";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const ctx = await getTenantContext();
    const messages = await getConversationMessages(ctx, id);
    return NextResponse.json({ messages });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
