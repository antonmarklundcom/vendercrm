import { redirect } from "next/navigation";
import Link from "next/link";
import { getSuperadminContext } from "@/modules/tenancy/context";

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await getSuperadminContext();
  } catch {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-6 border-b border-border px-6 py-4">
        <span className="font-semibold">VenderCRM · Superadmin</span>
        <nav className="flex gap-4 text-sm">
          <Link href="/superadmin/tenants" className="hover:underline">
            Tenants
          </Link>
          <Link href="/superadmin/plans" className="hover:underline">
            Planes
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col p-6">{children}</main>
    </div>
  );
}
