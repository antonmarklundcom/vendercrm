import { eq } from "drizzle-orm";
import { waAccounts } from "@/db/schema";
import { newId } from "@/lib/ids";
import { encrypt, decrypt } from "@/lib/crypto";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";

export type WaAccount = typeof waAccounts.$inferSelect;

// Manual connect (bootstrap path, PLAN.md §6.2): a tenant admin (or superadmin)
// enters the WABA id, phone number id, and a system-user access token. The
// token is encrypted at rest immediately (§3.4).
export async function connectManual(
  ctx: TenantContext,
  input: {
    wabaId: string;
    phoneNumberId: string;
    accessToken: string;
    displayNumber?: string;
    verifiedName?: string;
  },
): Promise<string> {
  const id = newId();
  const enc = encrypt(input.accessToken);
  await tenantDb(ctx).insert(waAccounts, {
    id,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayNumber: input.displayNumber,
    verifiedName: input.verifiedName,
    status: "connected",
    accessTokenCiphertext: enc.ciphertext,
    accessTokenIv: enc.iv,
    accessTokenTag: enc.tag,
    connectedVia: "manual",
    webhookSubscribedAt: new Date(),
  });
  return id;
}

export async function getAccountForTenant(ctx: TenantContext) {
  const [row] = await tenantDb(ctx).select(waAccounts);
  return row ?? null;
}

export async function getAccountById(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(waAccounts, eq(waAccounts.id, id));
  return row ?? null;
}

// Decrypts the stored access token. Kept here so callers never touch the raw
// ciphertext columns; returns null if the account has no token.
export function decryptAccessToken(account: WaAccount): string | null {
  if (
    !account.accessTokenCiphertext ||
    !account.accessTokenIv ||
    !account.accessTokenTag
  ) {
    return null;
  }
  return decrypt({
    ciphertext: account.accessTokenCiphertext,
    iv: account.accessTokenIv,
    tag: account.accessTokenTag,
  });
}
