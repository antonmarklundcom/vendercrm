"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Menu,
  Search,
  CalendarDays,
  CalendarClock,
  ChartNoAxesColumn,
  ClipboardList,
  FileSignature,
  FileText,
  Globe,
  LayoutDashboard,
  LayoutGrid,
  Landmark,
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
import { OPEN_SEARCH_EVENT } from "@/components/command-palette-event";

// Tenant app navigation. Client-side only because active-route highlighting
// needs the current pathname; every label arrives pre-translated from the
// server layout, so this component holds no copy of its own (§1.2: no
// hardcoded UI strings).

/** Icons can't cross the server/client boundary as components — the server
 * passes a key and this map resolves it here. */
const ICONS = {
  dashboard: LayoutDashboard,
  businesses: LayoutGrid,
  contacts: Users,
  companies: Building2,
  contracts: FileSignature,
  negocio: Landmark,
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
  /**
   * Folds behind its heading. Open on first render only when it holds the
   * current page, so the sidebar shows the daily items plus where you are,
   * not every route the product has.
   */
  collapsible?: boolean;
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

function NavGroups({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  return (
    <nav className="flex flex-col gap-4">
      {groups.map((group, index) => {
        const key = group.label ?? `group-${index}`;
        const links = group.items.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ));
        if (group.collapsible && group.label) {
          return (
            <CollapsibleGroup
              key={key}
              label={group.label}
              containsActive={group.items.some((item) => isActive(pathname, item.href))}
            >
              {links}
            </CollapsibleGroup>
          );
        }
        return (
          <div key={key} className="flex flex-col gap-0.5">
            {group.label && (
              <span className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase">
                {group.label}
              </span>
            )}
            {links}
          </div>
        );
      })}
    </nav>
  );
}

function CollapsibleGroup({
  label,
  containsActive,
  children,
}: {
  label: string;
  containsActive: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(containsActive);
  // Navigating into a folded group (⌘K, a link on the page) unfolds it, so
  // the active item is never hidden. Navigating out leaves it as the user
  // left it.
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center justify-between rounded-md px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase transition-colors hover:text-foreground"
      >
        {label}
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
      </button>
      {open && children}
    </div>
  );
}

export function AppNav({
  groups,
  appName,
  header,
  footer,
  mobileHeader,
  menuLabel,
  searchLabel,
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
  /** Same identity, in the single-row form, at the top on mobile. */
  mobileHeader?: React.ReactNode;
  /** Accessible name of the mobile menu button. */
  menuLabel: string;
  /** Accessible name of the mobile search button, which opens the same
   * palette as ⌘K — a phone has no keyboard shortcut to reach it with. */
  searchLabel?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = groups
    .flatMap((group) => group.items)
    .find((item) => isActive(pathname, item.href));

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Desktop: pinned daily items, then folding groups. */}
      <aside className="hidden w-60 shrink-0 flex-col gap-5 border-r bg-card px-3 py-4 md:flex">
        <Wordmark name={appName} className="px-3" />
        {header && <div className="-mx-3 -my-2">{header}</div>}
        <NavGroups groups={groups} pathname={pathname} />
        {footer && <div className="mt-auto">{footer}</div>}
      </aside>

      {/* Mobile: identity row and one bar naming where you are; everything
          else — switcher, notifications, the full nav — is one tap away
          instead of a 23-item strip scrolling sideways above every page. */}
      <div className="flex flex-col border-b bg-card md:hidden">
        {mobileHeader}
        <div className="flex items-stretch border-t">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="app-mobile-nav"
            aria-label={menuLabel}
            className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left text-sm font-medium"
          >
            <Menu className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{current?.label ?? appName}</span>
            <ChevronDown
              className={cn(
                "ml-auto size-4 text-muted-foreground transition-transform",
                mobileOpen && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
          {searchLabel && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
              aria-label={searchLabel}
              className="flex items-center border-l px-4 text-muted-foreground"
            >
              <Search className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {mobileOpen && (
          <div id="app-mobile-nav" className="flex flex-col gap-3 border-t px-3 pb-4">
            {header && <div className="-mx-3">{header}</div>}
            <NavGroups groups={groups} pathname={pathname} />
          </div>
        )}
      </div>
    </>
  );
}
