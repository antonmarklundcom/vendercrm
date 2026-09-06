"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { decideQuote } from "@/modules/quotes/public";
import { clientIp } from "@/lib/http/client-ip";

// The visitor's own accept/reject (PLAN.md §8, §15.8 P6). All the real
// validation (rate limit, status, the second-decision guard) lives in
// modules/quotes/public.ts — this only reads the form and the request.

export type DecisionState = {
  error: string | null;
  done: "accepted" | "rejected" | null;
};

const initialDecisionState: DecisionState = { error: null, done: null };
export { initialDecisionState };

export async function decideQuoteAction(
  token: string,
  _prevState: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const decision = formData.get("decision") === "rejected" ? "rejected" : "accepted";
  const name = String(formData.get("name") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim() || undefined;

  if (!name) return { error: "nameRequired", done: null };

  const headerList = await headers();
  const outcome = await decideQuote(token, {
    decision,
    name,
    comment,
    ipAddress: clientIp(headerList),
    userAgent: headerList.get("user-agent") ?? undefined,
  });

  if (!outcome.ok) return { error: outcome.reason, done: null };

  revalidatePath(`/q/${token}`);
  return { error: null, done: decision };
}
