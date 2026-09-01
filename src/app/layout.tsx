import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { THEME_SCRIPT, themeClass } from "@/lib/theme";
import { resolveTheme } from "@/lib/theme-resolve";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "clientes.com.py",
  description: "CRM de ventas con automatización por WhatsApp",
  // Installable on a phone's home screen (PLAN.md §13 H7). manifest.ts
  // describes the app; these are what iOS reads, which ignores the manifest
  // for the icon and the status bar.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "clientes.com.py", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c1a20",
  // The app is used one-handed on a phone; letting the browser chrome
  // resize with the keyboard is what keeps a reply box visible.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Follows the resolved locale (src/i18n/request.ts) rather than being
  // pinned to Spanish — screen readers and translation tooling both read it.
  const locale = await getLocale();

  // Appearance (PLAN.md §14 I3). The server can settle "dark" and "light"
  // from the cookie; only "system" needs the browser, so THEME_SCRIPT runs
  // before paint and corrects the class. suppressHydrationWarning covers
  // exactly that: the script is *expected* to have changed this attribute
  // before React looks at it.
  const theme = await resolveTheme();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${themeClass(theme)}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
