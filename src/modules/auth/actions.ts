"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./server";

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

// Superadmin stops impersonating and returns to their own console.
export async function stopImpersonatingAction() {
  await auth.api.stopImpersonating({ headers: await headers() });
  redirect("/superadmin");
}
