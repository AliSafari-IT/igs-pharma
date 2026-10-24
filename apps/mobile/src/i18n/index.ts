import type { Locale } from "../api/types";
import { STRINGS, type StringKey } from "./strings";

export const LOCALES: readonly Locale[] = ["nl", "fr", "de", "en"];

/** Each language in its own name, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  nl: "Nederlands",
  fr: "Français",
  de: "Deutsch",
  en: "English",
};

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** The first of the phone's languages the storefront has; Dutch, the storefront's default, otherwise. */
export function pickLocale(phoneLanguages: readonly (string | null | undefined)[]): Locale {
  for (const tag of phoneLanguages) {
    const language = tag?.toLowerCase().split(/[-_]/)[0];
    if (isLocale(language)) return language;
  }
  return "nl";
}

export type Translate = (key: StringKey, values?: Record<string, string | number>) => string;

/** `t()` for one language: the text with its `{name}` placeholders filled. */
export function translator(locale: Locale): Translate {
  const strings = STRINGS[locale];
  return (key, values) =>
    strings[key].replace(/\{(\w+)\}/g, (match, name: string) =>
      values && name in values ? String(values[name]) : match,
    );
}
