import Link from "next/link";
import { getTenantContext } from "@/modules/tenancy/context";
import { listConversations } from "@/modules/whatsapp/queries";
import { getContactById } from "@/modules/crm/queries";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const ctx = await getTenantContext();

  const filters =
    filter === "mine"
      ? { assignedUserId: ctx.userId }
      : filter === "unassigned"
        ? {}
        : {};

  const conversations = await listConversations(ctx, filters);
  const visible =
    filter === "unassigned"
      ? conversations.filter((c) => !c.assignedUserId)
      : conversations;

  const contacts = await Promise.all(
    visible.map((c) => getContactById(ctx, c.contactId)),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">WhatsApp — Bandeja</h1>
        <Link href="/whatsapp" className="text-sm hover:underline">
          Configurar número
        </Link>
      </div>

      <nav className="flex gap-4 text-sm">
        <Link href="/inbox" className={!filter ? "font-medium" : "text-muted-foreground"}>
          Todas
        </Link>
        <Link
          href="/inbox?filter=mine"
          className={filter === "mine" ? "font-medium" : "text-muted-foreground"}
        >
          Mías
        </Link>
        <Link
          href="/inbox?filter=unassigned"
          className={filter === "unassigned" ? "font-medium" : "text-muted-foreground"}
        >
          Sin asignar
        </Link>
      </nav>

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {visible.map((c, i) => (
          <Link
            key={c.id}
            href={`/inbox/${c.id}`}
            className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted"
          >
            <div>
              <p className="font-medium">{contacts[i]?.name ?? "?"}</p>
              <p className="text-muted-foreground">{contacts[i]?.phone}</p>
            </div>
            <div className="flex items-center gap-3">
              {c.unreadCount > 0 && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {c.unreadCount}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {c.lastMessageAt?.toISOString().slice(0, 16).replace("T", " ")}
              </span>
            </div>
          </Link>
        ))}
        {visible.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Sin conversaciones todavía.
          </p>
        )}
      </div>
    </div>
  );
}
