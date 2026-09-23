"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Below 768px the header's inline nav is hidden, so without this a phone
// visitor had no way to reach Método, Recursos or Contacto except the footer.
// A native <details> disclosure: it works before hydration, needs no focus
// trap, and the browser handles Enter/Space on the summary. The client half
// only closes it again after a client-side navigation, since the layout (and
// with it this element's open state) survives route changes.

export type MobileMenuLink = { href: string; label: string };

export function MobileMenu({
  label,
  links,
  cta,
}: {
  label: string;
  links: MobileMenuLink[];
  cta: { href: string; label: string };
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  return (
    <details ref={ref} className="mk-menu">
      <summary className="mk-menu__toggle" aria-label={label}>
        <span className="mk-menu__bars" aria-hidden="true" />
      </summary>
      <nav className="mk-menu__panel" aria-label={label}>
        <ul>
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={cta.href}
          className="mk-btn mk-btn--primary"
          data-ev="cta_click"
          data-ev-loc="header-menu"
        >
          {cta.label}
        </Link>
      </nav>
    </details>
  );
}
