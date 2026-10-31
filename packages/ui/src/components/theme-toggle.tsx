"use client";

import { useEffect, useState } from "react";

import { type ThemeChoice, themeCookie } from "../theme";

export interface ThemeToggleProps {
  /** The theme the server rendered from the cookie; `undefined` when it follows the system. */
  readonly initial?: ThemeChoice | undefined;
  /** The button's label in each direction, in the page's language. */
  readonly labels: { readonly toDark: string; readonly toLight: string };
  readonly className?: string;
  /** `topbar`: drawn on the charcoal storefront top bar (igs-pharma#193). */
  readonly tone?: "default" | "topbar";
}

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Switches between light and dark (igs-pharma#191): sets `data-theme` on `<html>` at once and
 * remembers the choice in the `igs_theme` cookie for the next page the server renders. A sun shows
 * in dark (go light), a moon in light (go dark). Until it mounts it renders with the server's theme
 * (the system's when there is none: the label then says "dark", the usual default).
 */
export function ThemeToggle({ initial, labels, className, tone = "default" }: ThemeToggleProps) {
  const [theme, setTheme] = useState<ThemeChoice>(initial ?? "light");
  useEffect(() => {
    if (!initial) setTheme(prefersDark() ? "dark" : "light");
  }, [initial]);

  const next: ThemeChoice = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? labels.toDark : labels.toLight;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      data-theme-now={theme}
      onClick={() => {
        document.documentElement.dataset["theme"] = next;
        document.cookie = themeCookie(next, window.location.protocol === "https:");
        setTheme(next);
      }}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-md)] ${
        tone === "topbar"
          ? "text-[var(--color-on-topbar)] hover:bg-[var(--color-topbar-raised)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      } ${className ?? ""}`}
    >
      {theme === "dark" ? (
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
