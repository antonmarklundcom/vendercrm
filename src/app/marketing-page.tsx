import Link from "next/link";

// Rendered on the apex/marketing domain (clientes.com.py) — the CRM app
// itself lives on the crm.* subdomain (see page.tsx's host check). Placeholder
// content; swap copy/sections freely, this file has no logic of its own.
export default function MarketingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold">VenderCRM</h1>
      <p className="text-lg text-muted-foreground">
        El CRM para vender más rápido en Paraguay.
      </p>
      <Link
        href="https://crm.clientes.com.py/login"
        className="rounded-md bg-black px-6 py-3 text-white"
      >
        Iniciar sesión
      </Link>
    </main>
  );
}
