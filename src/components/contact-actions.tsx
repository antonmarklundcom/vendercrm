import { MessageCircle, Phone } from "lucide-react";
import { telHref, waMeHref, type CountryCode } from "@/lib/phone";

/**
 * The two things a seller does with a contact, as thumb-sized buttons:
 * write on WhatsApp and call. Shown at the top of the contact and deal pages
 * so neither needs a copy-paste of the number. Renders nothing for a number
 * that cannot be dialed.
 */
export function ContactActions({
  phone,
  country,
  labels,
}: {
  phone: string | null | undefined;
  country?: CountryCode;
  labels: { whatsapp: string; call: string };
}) {
  const wa = waMeHref(phone, country);
  const tel = telHref(phone, country);
  if (!wa && !tel) return null;

  const button =
    "inline-flex min-h-10 items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted";

  return (
    <div className="flex flex-wrap gap-2">
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={button}>
          <MessageCircle className="size-4" aria-hidden />
          {labels.whatsapp}
        </a>
      )}
      {tel && (
        <a href={tel} className={button}>
          <Phone className="size-4" aria-hidden />
          {labels.call}
        </a>
      )}
    </div>
  );
}
