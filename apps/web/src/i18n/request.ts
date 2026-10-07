import { getRequestConfig } from "next-intl/server";

import { routing } from "@igs/i18n/routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? routing.defaultLocale;
  const validLocale = routing.locales.includes(locale as (typeof routing.locales)[number])
    ? (locale as (typeof routing.locales)[number])
    : routing.defaultLocale;

  // Dynamic import of locale messages from the i18n package
  const messages = (
    await import(`../../../../packages/i18n/messages/${validLocale}.json`)
  ).default as Record<string, unknown>;

  return {
    locale: validLocale,
    messages,
  };
});
