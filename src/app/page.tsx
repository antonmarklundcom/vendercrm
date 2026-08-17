import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import MarketingPage from "./marketing-page";

// Same Node app answers both the apex marketing domain and the crm.*
// subdomain (parked domain, shared document root — see hPanel Domains).
// Only the crm.* host runs the CRM itself; every other host (apex,
// www., Hostinger's own preview hostname) gets the marketing page.
const APP_HOST_PREFIX = "crm.";

// "/" carries no session guard of its own — (app)/layout.tsx and
// (superadmin)/layout.tsx each redirect to /login when unauthenticated, but
// only once you're already inside one of those route groups. Route straight
// to the right area (or /login) instead of showing a bare landing page.
export default async function Home() {
  const host = (await headers()).get("host") ?? "";
  if (!host.startsWith(APP_HOST_PREFIX)) {
    return <MarketingPage />;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user as { isSuperadmin?: boolean | null } | undefined;

  if (!user) redirect("/login");
  redirect(user.isSuperadmin ? "/tenants" : "/dashboard");
}
