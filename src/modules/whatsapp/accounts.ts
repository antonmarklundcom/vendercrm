import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { waAccounts } from "@/db/schema";
import { newId } from "@/lib/ids";
import { encrypt, decrypt } from "@/lib/crypto";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { scheduleTemplateSync } from "./sync-schedule";

// wa_accounts (PLAN.md §4, §6.2). Manual connect is the bootstrap path;
// Meta Embedded Signup (embedded-signup.ts) is the one-click path, shown only
// once the owner has configured it, and it stores through the same
// `storeConnectedAccount` below. Access tokens are encrypted at rest (§3.4) —
// plaintext only ever exists in memory for the duration of a Graph API call.

export type ConnectAccountManuallyInput = {
  wabaId: string;
  phoneNumberId: string;
  displayNumber?: string;
  accessToken: string;
};

export async function connectAccountManually(
  ctx: TenantContext,
  input: ConnectAccountManuallyInput,
) {
  return storeConnectedAccount(ctx, { ...input, connectedVia: "manual" });
}

export type StoreConnectedAccountInput = ConnectAccountManuallyInput & {
  connectedVia: "manual" | "embedded";
  verifiedName?: string;
  /** Set when this app itself subscribed to the WABA's webhooks. */
  webhookSubscribedAt?: Date;
};

/**
 * The one write path for a new wa_accounts row, shared by manual connect and
 * embedded signup so both encrypt the token and seed template sync the same
 * way.
 */
export async function storeConnectedAccount(
  ctx: TenantContext,
  input: StoreConnectedAccountInput,
) {
  const id = newId();
  const encrypted = encrypt(input.accessToken);

  await tenantDb(ctx)
    .insert(waAccounts)
    .values({
      id,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayNumber: input.displayNumber,
      verifiedName: input.verifiedName,
      status: "connected",
      accessTokenCiphertext: encrypted.ciphertext,
      accessTokenIv: encrypted.iv,
      accessTokenTag: encrypted.tag,
      connectedVia: input.connectedVia,
      webhookSubscribedAt: input.webhookSubscribedAt,
    });

  // "Fetch templates from Meta on connect" (§6.4) — enqueued rather than
  // awaited so a bad token surfaces as a visible job/account error instead
  // of failing the connect form the admin just submitted. This first run
  // also seeds the recurring nightly chain.
  await scheduleTemplateSync(ctx, id);

  return getAccount(ctx, id);
}

export async function getAccount(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(waAccounts, eq(waAccounts.id, id));
  return row ?? null;
}

export function listAccountsForTenant(ctx: TenantContext) {
  return tenantDb(ctx)
    .select(waAccounts)
    .then((rows) => rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

/** First connected account for the tenant — Phase 1 assumes one active number. */
export async function getPrimaryAccount(ctx: TenantContext) {
  const rows = await listAccountsForTenant(ctx);
  return rows.find((row) => row.status === "connected") ?? null;
}

export function getDecryptedAccessToken(account: { accessTokenCiphertext: string; accessTokenIv: string; accessTokenTag: string }): string {
  return decrypt({
    ciphertext: account.accessTokenCiphertext,
    iv: account.accessTokenIv,
    tag: account.accessTokenTag,
  });
}

/**
 * Webhook routing (§6.3 rule 3): "route phone_number_id → wa_accounts →
 * tenant." Unauthenticated by nature — there is no session, and no tenant
 * slug either, only what Meta sent. This is the one platform-wide read this
 * module needs (see eslint.config.mjs's exemption comment for this file).
 */
export async function resolveAccountByPhoneNumberId(phoneNumberId: string) {
  const [row] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.phoneNumberId, phoneNumberId));
  return row ?? null;
}

export async function markAccountError(accountId: string) {
  await db.update(waAccounts).set({ status: "error" }).where(eq(waAccounts.id, accountId));
}

/**
 * Clears a broken or unwanted connection. Deliberately just a status flip,
 * not a row delete: the token columns are `notNull` (§4), and the account id
 * stays valid for whatever already reference it (conversations, messages) —
 * exactly the "disconnected" state a fresh manual connect already produces
 * for a never-used row. `getPrimaryAccount` (status === "connected") and the
 * send path both already treat a non-connected account as unusable, so this
 * is enough to stop sends/receives without a second status check anywhere.
 */
export async function disconnectAccount(ctx: TenantContext, accountId: string) {
  await tenantDb(ctx)
    .update(waAccounts)
    .set({ status: "disconnected" })
    .where(eq(waAccounts.id, accountId));
  return getAccount(ctx, accountId);
}
