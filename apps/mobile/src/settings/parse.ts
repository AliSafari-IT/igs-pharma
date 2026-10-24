import type { Locale } from "../api/types";
import { isLocale } from "../i18n";

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  theme: ThemePreference;
  /** `system`: the first of the phone's languages the storefront has. */
  language: Locale | "system";
  largeText: boolean;
}

export const DEFAULTS: Settings = { theme: "system", language: "system", largeText: false };
export const STORED_AS = "igs.settings.v1";

/** Stored settings, keeping only values this version knows (an older or newer app may differ). */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    return {
      theme: value.theme === "light" || value.theme === "dark" ? value.theme : "system",
      language: isLocale(value.language) ? value.language : "system",
      largeText: value.largeText === true,
    };
  } catch {
    return DEFAULTS;
  }
}
