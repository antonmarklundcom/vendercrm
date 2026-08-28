import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Status as shape+colour, not just a word — reused across the tenant list
// (trial/active/suspended), pipeline stages, and WhatsApp health, wherever
// a plain-text status currently carries no visual weight of its own.

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-secondary text-secondary-foreground",
        success: "bg-success-surface text-success",
        warning: "bg-warning-surface text-warning",
        destructive: "bg-destructive-surface text-destructive",
        info: "bg-info-surface text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone, className }))} {...props} />;
}

export { badgeVariants };
