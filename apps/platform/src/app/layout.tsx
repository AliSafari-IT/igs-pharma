import type { ReactNode } from "react";

import "@igs/ui/styles/tokens.css";
import "@igs/ui/styles/global.css";

export const metadata = {
  title: "IGS-Pharma Platform",
  description: "Pharmacy back-office and management platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[var(--color-surface)] text-[var(--color-text)] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
