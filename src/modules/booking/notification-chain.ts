// The delivery chain, kept pure and free of imports so it can be reasoned
// about — and tested — without a WhatsApp account, a database or a clock.
//
// Every customer-facing booking notification walks the same four rungs
// (plan-booking.md §1): an approved Meta template, then a free-form WhatsApp
// message if the 24h window happens to be open, then email, then nothing.
// The order is not arbitrary. A template is the only rung that legally works
// for someone who booked on the website and has never messaged the business
// — which is most of them — so it goes first, and the window is a lucky
// shortcut rather than the plan. Email is the safety net for the tenant
// whose Meta templates are still in review.
//
// "Nothing" is a real outcome and is recorded as one: the booking view has
// to be able to say "no pudimos avisarle" rather than leave staff assuming
// the customer was told.

export const BOOKING_NOTIFICATION_KINDS = [
  "confirmation",
  "reminder",
  "cancellation",
  "reschedule",
  "deposit_request",
  "review_request",
] as const;

export type BookingNotificationKind = (typeof BOOKING_NOTIFICATION_KINDS)[number];

/** `none` is the fourth rung, not the absence of one. */
export type BookingNotificationChannel = "wa_template" | "wa_freeform" | "email" | "none";

export type ChannelAvailability = {
  /** The tenant has a connected WhatsApp account and the contact a phone. */
  whatsappReady: boolean;
  /** This kind's template exists at Meta with status APPROVED for that account. */
  templateApproved: boolean;
  /** The contact messaged us inside the last 24h, so free-form is legal. */
  windowOpen: boolean;
  /** We hold an email address for the contact. */
  hasEmail: boolean;
};

/**
 * The rungs still worth trying, best first. A list rather than a single
 * choice because a rung can fail at send time — Meta rejecting a template
 * that was APPROVED a minute ago, a token that just died — and a failure
 * there should fall through to the next rung instead of ending the attempt.
 */
export function channelChain(availability: ChannelAvailability): BookingNotificationChannel[] {
  const chain: BookingNotificationChannel[] = [];
  if (availability.whatsappReady && availability.templateApproved) chain.push("wa_template");
  if (availability.whatsappReady && availability.windowOpen) chain.push("wa_freeform");
  if (availability.hasEmail) chain.push("email");
  return chain.length > 0 ? chain : ["none"];
}

/** The rung that would be tried first — what the four selection branches are about. */
export function selectChannel(availability: ChannelAvailability): BookingNotificationChannel {
  return channelChain(availability)[0];
}
