import { THEME_COOKIE, themeFromCookie } from "@igs/ui";
import { fontDisplay, fontSans } from "@igs/ui/fonts";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

// Tailwind + @igs/ui tokens + global base styles (one entry, T-015)
import "../globals.css";

// CSP nonces are per request (src/proxy.ts, T-011): prerendered HTML would carry no nonce and its
// scripts would be blocked, so every page renders dynamically (accepted trade-off, D-031/D-008).
export const dynamic = "force-dynamic";

// the brand name is not translated; per-page titles come with the feature pages
export const metadata = { title: "IGS-Pharma" };

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();
  // the visitor's light/dark choice (igs-pharma#191); without one the system setting decides
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang={locale}
      className={`${fontSans.variable} ${fontDisplay.variable}`}
      {...(theme ? { "data-theme": theme } : {})}
    >
      <body className="bg-[var(--color-page)] text-[var(--color-text)] font-sans antialiased">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
