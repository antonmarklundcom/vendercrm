"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Building2, Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { switchBusinessAction } from "@/app/(app)/actions";

// Moving between the businesses one person works in (PLAN.md §3.1).
//
// Only rendered when there is more than one to move between — a switcher with
// a single option is a control that does nothing, and the tenant name is
// already shown in the user menu below it.
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

export function BusinessSwitcher({
  businesses,
  activeId,
  labels,
}: {
  businesses: SwitchableBusiness[];
  activeId: string;
  labels: { title: string; current: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  if (businesses.length < 2) return null;

  const active = businesses.find((b) => b.id === activeId);

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
    startTransition(() => {
      form.requestSubmit();
    });
  }

  return (
    <div className="relative px-3 py-2">
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
          "flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-sm",
          "transition-colors hover:bg-accent disabled:opacity-60",
        )}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
        <ul
          role="listbox"
          aria-label={labels.title}
          className={cn(
            // Capped and scrollable: an operator in a dozen businesses gets a
            // list that fits the sidebar instead of one that runs off the
            // bottom of the screen with the last entries unreachable.
            "absolute left-3 right-3 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border",
            "bg-popover text-popover-foreground shadow-md",
          )}
        >
          {businesses.map((business) => {
            const isActive = business.id === activeId;
            return (
              <li key={business.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => choose(business.id)}
                  disabled={pending}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                    "transition-colors hover:bg-accent disabled:opacity-60",
                  )}
                >
                  <Check
                    className={cn("size-4 shrink-0", !isActive && "invisible")}
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
      )}
    </div>
  );
}
