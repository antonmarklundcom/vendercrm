"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// The modal shape the command palette introduced (§13 H8), lifted into a
// primitive so the next one — a confirm, a drawer — doesn't reinvent the
// overlay, the click-outside, or the Escape handling.
function Dialog({
  open,
  onClose,
  label,
  className,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name; the dialog has no visible title of its own. */
  label: string;
  className?: string;
  /**
   * Escape and click-outside close the dialog by default. Set false when
   * leaving costs something irreversible (§18.1.1: the ops token's one-time
   * reveal) — the body then has to offer the only way out itself.
   */
  dismissible?: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open || !dismissible) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className={cn(
          "flex w-full max-w-lg flex-col overflow-hidden rounded-md border bg-background shadow-lg",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export { Dialog };
