/**
 * Light and dark (igs-pharma#191, milestone 5.2). The system setting decides until the visitor picks
 * one with the theme toggle; the choice is remembered in the `igs_theme` cookie (host-only, so the shop
 * and the back-office keep their own) and the root layout writes it on `<html data-theme>`, so the
 * server renders the right theme and nothing flashes.
 */

export const THEME_COOKIE = "igs_theme";
export const THEMES = ["light", "dark"] as const;
export type ThemeChoice = (typeof THEMES)[number];

/** A year: the choice outlives the session, like the language. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The visitor's choice from the cookie's value; `undefined` (follow the system) for anything else. */
export function themeFromCookie(value: string | undefined): ThemeChoice | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/** The `Set-Cookie`-style string the toggle writes (`Secure` on https). */
export function themeCookie(theme: ThemeChoice, secure: boolean): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
