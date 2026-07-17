import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/tenancy/context";

// Root router: send each user to where they belong based on their session.
export default async function Home() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.isSuperadmin) redirect("/superadmin");
  redirect("/app");
}
