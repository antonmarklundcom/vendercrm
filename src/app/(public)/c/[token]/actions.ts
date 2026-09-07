"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { decideContract, generateContractPdf, getContractByPublicToken } from "@/modules/contracts/contracts";
import { clientIp } from "@/lib/http/client-ip";

// The visitor's own accept/decline (PLAN.md §17.3 P13) — same shape as the
// quote's public decision (modules/quotes/public.ts), plus the SHA-256 of the
// exact PDF bytes the visitor was shown, which is the evidence a
// *firma electrónica simple* stands on.

export type ContractDecisionState = {
  error: string | null;
  done: "accepted" | "declined" | null;
};

const initialContractDecisionState: ContractDecisionState = { error: null, done: null };
export { initialContractDecisionState };

export async function decideContractAction(
  token: string,
  _prevState: ContractDecisionState,
  formData: FormData,
): Promise<ContractDecisionState> {
  const decision = formData.get("decision") === "declined" ? "declined" : "accepted";
  const nameTyped = String(formData.get("name") ?? "").trim();
  if (!nameTyped) return { error: "nameRequired", done: null };

  const resolved = await getContractByPublicToken(token);
  if (!resolved) return { error: "invalid", done: null };

  // The bytes shown to this visitor are rendered fresh, exactly like the
  // public PDF route — hashing them here is what makes the stored digest
  // trustworthy evidence of what they actually saw.
  const pdfBytes = await generateContractPdf(resolved.ctx, resolved.contract.id);

  const headerList = await headers();
  const outcome = await decideContract(token, {
    decision,
    nameTyped,
    ipAddress: clientIp(headerList),
    userAgent: headerList.get("user-agent") ?? undefined,
    pdfBytes,
  });

  if (!outcome.ok) return { error: outcome.reason, done: null };

  revalidatePath(`/c/${token}`);
  return { error: null, done: decision };
}
