"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarDays,
  CalendarClock,
  ChartNoAxesColumn,
  ClipboardList,
  FileText,
  Globe,
  LayoutDashboard,
  MessagesSquare,
  MessageCircle,
  Package,
  Receipt,
  ScrollText,
  Settings,
  Smartphone,
  SquareKanban,
  UserCog,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/wordmark";

// Tenant app navigation. Client-side only because active-route highlighting
// needs the current pathname; every label arrives pre-translated from the
// server layout, so this component holds no copy of its own (§1.2: no
// hardcoded UI strings).

/** Icons can't cross the server/client boundary as components — the server
 * passes a key and this map resolves it here. */
const ICONS = {
  dashboard: LayoutDashboard,
  contacts: Users,
  companies: Building2,
  pipeline: SquareKanban,
  calendar: CalendarDays,
  inbox: MessagesSquare,
  quotes: FileText,
  documents: ScrollText,
  products: Package,
  reports: ChartNoAxesColumn,
  automations: Workflow,
  forms: ClipboardList,
  sites: Globe,
  booking: CalendarClock,
  chat: MessageCircle,
  whatsapp: Smartphone,
  users: UserCog,
  settings: Settings,
  facturaElectronica: Receipt,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Renders inert (Phase 2 placeholder, PLAN.md §8). */
  disabled?: boolean;
  /** Small pill under the label — "Próximamente" for the Phase 2 item. */
  badge?: string;
};

export type NavGroup = {
  /** Translated group heading, or null for the ungrouped top item. */
  label: string | null;
  items: NavItem[];
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = ICONS[item.icon];
  const className = cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
    active
      ? "bg-accent font-medium text-accent-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );

  if (item.disabled) {
    return (
      <span
        aria-disabled="true"
        title={item.label}
        className={cn(
          className,
          "items-start cursor-not-allowed text-muted-foreground/60 hover:bg-transparent",
        )}
      >
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {/* Label and badge stack: "Factura electrónica Próximamente" on one
            line doesn't fit the sidebar width. */}
        <span className="flex min-w-0 flex-col items-start gap-1">
          {item.label}
          {item.badge && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none">
              {item.badge}
            </span>
          )}
        </span>
      </span>
    );
  }

  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={className}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  );
}

export function AppNav({
  groups,
  appName,
  header,
  footer,
  mobileHeader,
}: {
  groups: NavGroup[];
  appName: string;
  /** Above the nav on both layouts — the business switcher, when there is
   * more than one business to switch between (PLAN.md §3.1). Which business
   * you are in outranks where you are in it, so it sits at the top rather
   * than beside the identity at the bottom. */
  header?: React.ReactNode;
  /** Sits at the bottom of the desktop sidebar — the user menu. */
  footer?: React.ReactNode;
  /** Same identity, in the single-row form, above the mobile nav strip. */
  mobileHeader?: React.ReactNode;
}) {
  const pathname = usePathname();
  const flatItems = groups.flatMap((group) => group.items);

  return (
    <>
      {/* Desktop: grouped sidebar. */}
      <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r bg-card px-3 py-4 md:flex">
        <Wordmark name={appName} className="px-3" />
        {header && <div className="-mx-3 -my-2">{header}</div>}
        <nav className="flex flex-col gap-5">
          {groups.map((group, index) => (
            <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
              {group.label && (
                <span className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase">
                  {group.label}
                </span>
              )}
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
              ))}
            </div>
          ))}
        </nav>
        {footer && <div className="mt-auto">{footer}</div>}
      </aside>

      {/* Mobile: identity row, then one scrollable strip — grouping costs
          more than it buys on a phone, but the icons and the active state
          still carry over. */}
      <div className="flex flex-col bg-card md:hidden">
        {mobileHeader}
        {header}
        <nav className="flex gap-1 overflow-x-auto border-b px-3 py-2">
          {flatItems.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </nav>
      </div>
    </>
  );
}
