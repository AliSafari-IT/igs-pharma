import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["nl", "fr", "de", "en"] as const,
  defaultLocale: "nl",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
export const locales = routing.locales;
export const defaultLocale = routing.defaultLocale;
