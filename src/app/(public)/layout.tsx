// Everything under (public) is read by a customer, not by a user of the app:
// a quote, a nota de venta, a booking page, an embedded form or chat widget.
// None of those people ever chose an appearance, and a signed-in user's dark
// preference must not follow them here — a customer opening a quote link on
// the same browser should see the document as it prints (PLAN.md §14 I3).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-light">{children}</div>;
}
