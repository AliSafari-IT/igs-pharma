import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import "@igs/ui/styles/tokens.css";
import "@igs/ui/styles/global.css";

// CSP nonces are per request (src/proxy.ts, T-011): prerendered HTML would carry no nonce and its
// scripts would be blocked, so every page renders dynamically (accepted trade-off, D-031/D-008).
export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <html lang={locale} className={inter.variable}>
      <body className="bg-[var(--color-bg)] text-[var(--color-text)] font-sans antialiased">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
