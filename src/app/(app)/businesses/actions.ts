"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/tenancy/context";
import { MembershipError, switchActiveTenant } from "@/modules/tenancy/memberships";
import { conversationBelongsTo } from "@/modules/tenancy/portfolio";
import { resolveSwitchTarget, SWITCH_FALLBACK } from "@/modules/tenancy/switch-target";

// The overview's one write: step into a business, optionally straight into a
// conversation. Same trust model as `switchBusinessAction` — the tenant id is
// only as good as the live membership `switchActiveTenant` finds for it, and
// the destination is reduced to a known section. The one addition is a
// conversation id, which is honoured only after checking it belongs to the
// business just entered; anything else lands on that business's inbox.
const openSchema = z.object({
  tenantId: z.string().min(1).max(26),
  to: z.string().max(100).optional(),
  channel: z.enum(["whatsapp", "webchat"]).optional(),
  conversationId: z
    .string()
    .regex(/^[0-9A-Za-z]{26}$/)
    .optional(),
});

export async function openBusinessAction(formData: FormData) {
  const ctx = await requireTenantContext();

  const parsed = openSchema.safeParse({
    tenantId: formData.get("tenantId"),
    to: formData.get("to") ?? undefined,
    channel: formData.get("channel") ?? undefined,
    conversationId: formData.get("conversationId") ?? undefined,
  });
  if (!parsed.success) return;
  const { tenantId, to, channel, conversationId } = parsed.data;

  let target = SWITCH_FALLBACK;
  try {
    const membership = await switchActiveTenant(ctx.userId, tenantId);
    if (channel && conversationId) {
      const owned = await conversationBelongsTo(tenantId, channel, conversationId);
      // Web chat has no per-conversation route yet; its transcripts render
      // inline on /chat (see inbox/rows.ts).
      target = !owned ? "/inbox" : channel === "whatsapp" ? `/inbox/${conversationId}` : "/chat";
    } else {
      target = resolveSwitchTarget(to, membership.role);
    }
  } catch (err) {
    if (err instanceof MembershipError) return;
    throw err;
  }

  revalidatePath("/", "layout");
  redirect(target);
}
