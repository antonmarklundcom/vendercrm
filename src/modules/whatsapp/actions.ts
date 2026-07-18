"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenantContext } from "@/modules/tenancy/context";
import { waAccounts, waTemplates } from "@/db/schema/whatsapp";
import { encrypt } from "@/lib/crypto";
import { fetchTemplates } from "./graph-api";
import { getDecryptedAccessToken } from "./queries";

function assertAdmin(role: string) {
  if (role !== "admin") {
    throw new Error("Solo un administrador puede gestionar la conexión de WhatsApp");
  }
}

export async function connectWhatsAppManual(input: {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  displayNumber?: string;
  verifiedName?: string;
}): Promise<void> {
  const ctx = await getTenantContext();
  assertAdmin(ctx.role);

  const encrypted = encrypt(input.accessToken);

  await tenantDb(ctx).insert(waAccounts, {
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayNumber: input.displayNumber || null,
    verifiedName: input.verifiedName || null,
    accessTokenCiphertext: encrypted.ciphertext,
    accessTokenIv: encrypted.iv,
    accessTokenTag: encrypted.tag,
    connectedVia: "manual",
  });

  revalidatePath("/whatsapp");
}

export async function syncTemplates(waAccountId: string): Promise<void> {
  const ctx = await getTenantContext();
  assertAdmin(ctx.role);

  const scoped = tenantDb(ctx);
  const account = await scoped.findFirst(waAccounts, eq(waAccounts.id, waAccountId));
  if (!account) throw new Error("WhatsApp account not found");

  const accessToken = getDecryptedAccessToken(account);
  const templates = await fetchTemplates(account.wabaId, accessToken);

  for (const t of templates) {
    const existing = await scoped.findFirst(
      waTemplates,
      and(
        eq(waTemplates.waAccountId, account.id),
        eq(waTemplates.name, t.name),
        eq(waTemplates.language, t.language),
      ),
    );

    const status = t.status.toLowerCase() as "approved" | "pending" | "rejected";

    if (existing) {
      await scoped.update(
        waTemplates,
        { status, category: t.category, components: t.components },
        eq(waTemplates.id, existing.id),
      );
    } else {
      await scoped.insert(waTemplates, {
        waAccountId: account.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status,
        components: t.components,
      });
    }
  }

  revalidatePath(`/whatsapp/${waAccountId}`);
}
