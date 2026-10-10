import localFont from "next/font/local";

/**
 * Self-hosted Inter and Fraunces (T-017): committed WOFF2 subsets (Latin + Latin Extended), served
 * from /_next/static/media under `font-src 'self'`. No build-time or runtime network access.
 * Provenance and the subsetting command: packages/ui/README.md. Licences: ./fonts/OFL-*.txt.
 *
 * Put both `.variable` classes on <html>: they set --font-sans / --font-display, which win over the
 * @theme defaults in tokens.css.
 */
// next/font names the family after the variable it is assigned to ("inter", "fraunces")
const inter = localFont({
  src: "./fonts/InterVariable-latin-ext.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const fraunces = localFont({
  src: "./fonts/Fraunces-latin-ext.woff2",
  variable: "--font-display",
  weight: "100 900",
  display: "swap",
  fallback: ["ui-serif", "Georgia", "serif"],
});

export const fontSans = inter;
export const fontDisplay = fraunces;
