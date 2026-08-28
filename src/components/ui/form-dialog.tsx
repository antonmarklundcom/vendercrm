"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Plus, X, type LucideIcon } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Lets a create-form live off-screen until someone asks for it, instead of
// sitting permanently under the list it feeds (§10 audit: "Nuevo contacto" /
// "Nuevo negocio" / "Nueva pipeline" read as unfinished admin scaffolding
// when they're always-on blocks under the table/board).
//
// The form inside doesn't need to know it's in a dialog — it calls
// useFormDialogClose() when its own action reports success, same as it
// would call a local setState in a non-dialog layout.

const FormDialogCloseContext = React.createContext<() => void>(() => {});

export function useFormDialogClose() {
  return React.useContext(FormDialogCloseContext);
}

export function FormDialogTrigger({
  id,
  label,
  title,
  description,
  icon: Icon = Plus,
  variant = "outline",
  children,
}: {
  /** Also the URL hash (`#id`) that opens the dialog on load — the anchor
   * the empty-state CTAs already point at. */
  id: string;
  label: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  variant?: React.ComponentProps<typeof Button>["variant"];
  children: React.ReactNode;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function checkHash() {
      if (window.location.hash === `#${id}`) setOpen(true);
    }
    checkHash();
    // Covers the EmptyState CTAs, which are plain `#id` anchors pointing at
    // this trigger — a real anchor click fires hashchange even when the
    // hash was already set at mount.
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, [id]);

  const close = React.useCallback(() => setOpen(false), []);

  return (
    <>
      <Button id={id} type="button" variant={variant} size="sm" onClick={() => setOpen(true)}>
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </Button>
      <Dialog open={open} onClose={close} label={title}>
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("close")}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">
          <FormDialogCloseContext.Provider value={close}>{children}</FormDialogCloseContext.Provider>
        </div>
      </Dialog>
    </>
  );
}
