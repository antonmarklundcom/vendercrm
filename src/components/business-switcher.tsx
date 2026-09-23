"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { switchBusinessAction } from "@/app/(app)/actions";

// Moving between the businesses one person works in (PLAN.md §3.1).
//
// Only rendered when there is more than one to move between — a switcher with
// a single option is a control that does nothing, and the tenant name is
// already shown in the user menu below it.
//
// The owner runs 27 businesses from one login, so an alphabetical dropdown
// isn't enough: the panel opens with a search field focused, the last few
// businesses used sit above the full list, and the arrow keys move through
// whatever is visible. Recency is a per-browser convenience in localStorage
// (never a source of truth), so it degrades to the plain list when storage
// is unavailable.
//
// The current path rides along in a hidden field so the switch can keep you
// in the same section: pipeline to pipeline, inbox to inbox. The server
// decides what that means — a record id from the business you are leaving is
// dropped there, not here, since a client-side rule is not a boundary.

export type SwitchableBusiness = {
  id: string;
  name: string;
  /** This user's role in that business — it can differ from the current one. */
  role: string;
};

const RECENT_KEY = "vcrm:recent-businesses";
const RECENT_MAX = 4;
/** Below this the list fits at a glance and a search field is noise. */
const SEARCH_THRESHOLD = 7;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((v) => v !== id)].slice(0, RECENT_MAX + 1);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private window, policy): recency just doesn't persist.
  }
}

/** Accent- and case-insensitive: "clinica" finds "Clínica Demo". */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function BusinessSwitcher({
  businesses,
  activeId,
  labels,
}: {
  businesses: SwitchableBusiness[];
  activeId: string;
  labels: {
    title: string;
    current: string;
    search: string;
    recent: string;
    all: string;
    empty: string;
  };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The business you're in counts as used.
  useEffect(() => {
    pushRecent(activeId);
  }, [activeId]);

  useEffect(() => {
    if (!open) return;
    setRecentIds(readRecent());
    setQuery("");
    setCursor(0);
    searchRef.current?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const sorted = useMemo(
    () => [...businesses].sort((a, b) => a.name.localeCompare(b.name, "es")),
    [businesses],
  );

  // One flat list of visible options drives both rendering and the arrow
  // keys; `section` marks where a heading goes.
  const options = useMemo(() => {
    const q = fold(query.trim());
    if (q) {
      return sorted
        .filter((b) => fold(b.name).includes(q))
        .map((business) => ({ business, section: null as string | null }));
    }
    const byId = new Map(businesses.map((b) => [b.id, b]));
    const recent = recentIds
      .filter((id) => id !== activeId)
      .map((id) => byId.get(id))
      .filter((b): b is SwitchableBusiness => Boolean(b))
      .slice(0, RECENT_MAX - 1);
    if (recent.length === 0 || businesses.length < SEARCH_THRESHOLD) {
      return sorted.map((business) => ({ business, section: null as string | null }));
    }
    return [
      ...recent.map((business, i) => ({ business, section: i === 0 ? labels.recent : null })),
      ...sorted.map((business, i) => ({ business, section: i === 0 ? labels.all : null })),
    ];
  }, [query, sorted, businesses, recentIds, activeId, labels.recent, labels.all]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (businesses.length < 2) return null;

  const active = businesses.find((b) => b.id === activeId);
  const showSearch = businesses.length >= SEARCH_THRESHOLD;

  function choose(tenantId: string) {
    if (tenantId === activeId) {
      setOpen(false);
      return;
    }
    const form = formRef.current;
    if (!form) return;
    const field = form.elements.namedItem("tenantId") as HTMLInputElement | null;
    if (!field) return;
    field.value = tenantId;
    pushRecent(tenantId);
    startTransition(() => {
      form.requestSubmit();
    });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      const option = options[cursor];
      if (option) {
        event.preventDefault();
        choose(option.business.id);
      }
    }
  }

  const listboxId = "business-switcher-list";

  return (
    <div ref={rootRef} className="relative px-3 py-2">
      <form ref={formRef} action={switchBusinessAction} className="hidden">
        <input type="hidden" name="tenantId" defaultValue="" />
        <input type="hidden" name="pathname" value={pathname ?? ""} readOnly />
      </form>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border bg-background px-2 py-2 text-left text-sm shadow-xs",
          "transition-colors hover:bg-accent disabled:opacity-60",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          {(active?.name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs text-muted-foreground">{labels.title}</span>
          <span className="truncate font-medium">{active?.name ?? labels.current}</span>
        </span>
        <ChevronsUpDown
          className="ml-auto size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className={cn(
            // Wider than the sidebar on desktop so long names aren't truncated
            // to uselessness; the panel floats over the page, not the nav.
            "absolute left-3 z-30 mt-1 flex w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-md border md:w-72",
            "bg-popover text-popover-foreground shadow-lg",
          )}
          onKeyDown={onKeyDown}
        >
          {showSearch && (
            <label className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCursor(0);
                }}
                placeholder={labels.search}
                aria-label={labels.search}
                aria-controls={listboxId}
                aria-activedescendant={options[cursor] ? `bs-opt-${cursor}` : undefined}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          )}
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={labels.title}
            // Focusable itself when there's no search field, so the arrow
            // keys still have somewhere to land.
            tabIndex={showSearch ? -1 : 0}
            className="max-h-80 overflow-y-auto py-1"
          >
            {options.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">{labels.empty}</li>
            )}
            {options.map(({ business, section }, index) => {
              const isActive = business.id === activeId;
              return (
                <li key={`${section ?? ""}${business.id}-${index}`} role="presentation">
                  {section && (
                    <span className="block px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase">
                      {section}
                    </span>
                  )}
                  <button
                    type="button"
                    id={`bs-opt-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => choose(business.id)}
                    onMouseEnter={() => setCursor(index)}
                    disabled={pending}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                      "transition-colors disabled:opacity-60",
                      index === cursor && "bg-accent",
                    )}
                  >
                    <Check
                      className={cn("size-4 shrink-0 text-primary", !isActive && "invisible")}
                      aria-hidden="true"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{business.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {business.role}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

