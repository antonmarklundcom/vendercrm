import { cn } from "@/lib/utils";

// Initials badge — the one piece of identity a contact/deal/team row can
// always show without new data: the name it already has. Gives every list
// (contacts, deal cards, team) a face to scan instead of a wall of text.
// Uses the app's own accent token rather than a new palette, so it stays
// correct in dark mode for free.

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  size = "sm",
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const sizeClass = { xs: "size-5 text-[10px]", sm: "size-7 text-xs", md: "size-9 text-sm" }[size];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground",
        sizeClass,
        className,
      )}
      aria-hidden="true"
      title={name}
    >
      {initials(name)}
    </span>
  );
}
