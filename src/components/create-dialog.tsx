"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Occasional creation ("Nuevo negocio", "Nuevo contacto"…) used to render as
// a full form under every board and table, so each list page was the working
// surface plus a second page stacked below it. This is the one pattern that
// replaces that: a primary button in the page header opening the same form
// in a dialog (prompts/fable-crm-design-calm-down.md, goal 1).
//
// It closes itself three ways, so each kind of form needs no extra wiring:
//  - a URL change — actions that `redirect()` (to the new record, or back to
//    the list with a new query) land somewhere new;
//  - `closeOnSubmit` — plain `<form action={serverAction}>` forms have no
//    client error state to show, so leaving the dialog open after submit
//    would only present an emptied form;
//  - `useCloseCreateDialog()` — stateful forms (useActionState) call it once
//    their state says the record was created, and keep the dialog open to
//    show field errors otherwise.
//
// `id` keeps the old in-page anchors working: empty states link to
// `#nuevo-negocio` and the like, and arriving on that hash opens the dialog.

const CloseContext = React.createContext<(() => void) | null>(null);

/** For a form rendered inside a CreateDialog: closes it. No-op elsewhere, so
 * the same form still works if it is rendered inline. */
export function useCloseCreateDialog(): () => void {
  const close = React.useContext(CloseContext);
  return close ?? noop;
}

function noop() {}

export function CreateDialog({
  id,
  triggerLabel,
  title,
  closeLabel,
  closeOnSubmit = false,
  wide = false,
  variant = "default",
  icon,
  children,
}: {
  /** Hash that opens the dialog on arrival, without the `#`. */
  id: string;
  triggerLabel: string;
  title: string;
  closeLabel: string;
  closeOnSubmit?: boolean;
  /** For forms with line items (quotes, sale notes). */
  wide?: boolean;
  variant?: "default" | "outline";
  /** Trigger icon; defaults to the "+" this component is named for. Pass a
   * different icon (or null) for a trigger that isn't a creation form, e.g.
   * "Editar". */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const titleId = `${id}-title`;

  const close = React.useCallback(() => {
    setOpen(false);
    if (window.location.hash === `#${id}`) {
      // Drop the hash so a reload doesn't reopen what was just closed.
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [id]);

  React.useEffect(() => {
    function syncFromHash() {
      if (window.location.hash === `#${id}`) setOpen(true);
    }
    // Next's <Link> changes a same-page hash with pushState, which fires no
    // hashchange, so a click on any link to this hash opens it too.
    function onClick(event: MouseEvent) {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (link && link.getAttribute("href")?.endsWith(`#${id}`)) setOpen(true);
    }
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      document.removeEventListener("click", onClick);
    };
  }, [id]);

  // Keyboard users land in the form, not on the page behind the overlay.
  const bodyRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    bodyRef.current
      ?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button")
      ?.focus();
  }, [open]);

  // A navigation means the action went somewhere: close. Skips the first
  // run so arriving on the page doesn't count as one.
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setOpen(false);
  }, [pathname, search]);

  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {icon === undefined ? <Plus className="size-4" aria-hidden="true" /> : icon}
        {triggerLabel}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        label={title}
        className={cn("max-h-[85vh]", wide ? "max-w-3xl" : "max-w-md")}
      >
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div
          ref={bodyRef}
          className="overflow-y-auto px-5 py-4 [&_form]:max-w-none"
          onSubmitCapture={
            closeOnSubmit
              ? (event) => {
                  // Let React dispatch the form action first; closing in the
                  // same tick would unmount the form under it.
                  if ((event.target as HTMLFormElement).checkValidity()) {
                    setTimeout(close, 0);
                  }
                }
              : undefined
          }
        >
          <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
        </div>
      </Dialog>
    </>
  );
}

/**
 * For a useActionState form inside a CreateDialog: closes the dialog once an
 * action result arrives that `succeeded` says is a success. The first state
 * (the form's initial one) never counts, so opening the dialog doesn't close
 * it.
 */
export function useCloseCreateDialogOnSuccess<S>(state: S, succeeded: (state: S) => boolean) {
  const close = useCloseCreateDialog();
  const initial = React.useRef(state);
  const done = state !== initial.current && succeeded(state);
  React.useEffect(() => {
    if (done) close();
  }, [done, state, close]);
}
