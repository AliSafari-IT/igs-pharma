import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { THEME_COOKIE, ThemeToggle, themeCookie, themeFromCookie } from "./index";

describe("the theme choice (igs-pharma#191)", () => {
  it("reads only light or dark from the cookie; anything else follows the system", () => {
    expect(themeFromCookie("light")).toBe("light");
    expect(themeFromCookie("dark")).toBe("dark");
    for (const value of [undefined, "", "system", "DARK", "dark; x=1"]) {
      expect(themeFromCookie(value), String(value)).toBeUndefined();
    }
  });

  it("remembers it for a year on the whole host, Secure on https", () => {
    expect(themeCookie("dark", true)).toBe(
      `${THEME_COOKIE}=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
    expect(themeCookie("light", false)).not.toContain("Secure");
  });

  it("the toggle offers the other theme, labelled in the page's language", () => {
    const labels = { toDark: "Donker thema gebruiken", toLight: "Licht thema gebruiken" };
    const light = renderToStaticMarkup(<ThemeToggle initial="light" labels={labels} />);
    expect(light).toContain('aria-label="Donker thema gebruiken"');
    expect(light).toContain('data-theme-now="light"');
    const dark = renderToStaticMarkup(<ThemeToggle initial="dark" labels={labels} />);
    expect(dark).toContain('aria-label="Licht thema gebruiken"');
    expect(dark).toContain("min-h-[44px]");
  });
});
