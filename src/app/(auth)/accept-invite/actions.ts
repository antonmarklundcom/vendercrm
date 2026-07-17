"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptInvitation } from "@/modules/tenancy/service";
import { auth } from "@/modules/auth/server";

const schema = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
  password: z.string().min(8),
});

export type AcceptInviteState = { error: string | null };

export async function acceptInviteAction(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    name: formData.get("name"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Datos inválidos" };

  let email: string;
  try {
    ({ email } = await acceptInvitation(parsed.data));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error" };
  }

  // Sign the new user in immediately (sets the session cookie), then land them
  // in the tenant app.
  await auth.api.signInEmail({
    body: { email, password: parsed.data.password },
    headers: await headers(),
  });
  redirect("/app");
}
