import { waMeHref, type CountryCode } from "@/lib/phone";

/**
 * A phone number that opens WhatsApp (plan-booking.md §6.2).
 *
 * Every list and detail view in the CRM shows numbers, and on every one of
 * them the rep's next action is to write to the person — in a country where
 * that is the channel. Rendering the number as plain text made them copy it
 * into WhatsApp by hand.
 *
 * Falls back to plain text rather than a dead link when the number cannot be
 * dialed, so a malformed row stays readable.
 */
export function WhatsAppLink({
  phone,
  country,
  text,
  className,
  children,
}: {
  phone: string | null | undefined;
  country?: CountryCode;
  /** Prefilled first message, when the view knows what it would be about. */
  text?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const href = waMeHref(phone, country, text);
  const label = children ?? phone ?? "";
  if (!href) return <>{label}</>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "underline underline-offset-2 hover:text-foreground"}
      title="WhatsApp"
    >
      {label}
    </a>
  );
}
