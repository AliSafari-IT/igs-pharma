// The storefront account pages (igs-pharma#115): 404 for every flag value but "true", and for an
// unknown locale; never indexed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => `[${key}]`,
}));
vi.mock("../src/server/storefront", () => ({
  localeOf: (value: string) => (["nl", "fr", "de", "en"].includes(value) ? value : null),
}));

const KEY = "NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
});
afterEach(() => {
  if (saved === undefined) Reflect.deleteProperty(process.env, KEY);
  else process.env[KEY] = saved;
});

const setFlag = (value: string | undefined) => {
  if (value === undefined) Reflect.deleteProperty(process.env, KEY);
  else process.env[KEY] = value;
};

describe("account pages", () => {
  it("are a 404 while the flag is off or unset", async () => {
    const { accountLocale } = await import("../src/server/account");
    for (const value of [undefined, "false", "", "yes", "TRUE", "1"]) {
      setFlag(value);
      expect(() => accountLocale("nl"), String(value)).toThrow(NOT_FOUND);
    }
  });

  it("serve the shopper's locale when the flag is on, and a 404 for any other locale", async () => {
    setFlag("true");
    const { accountLocale } = await import("../src/server/account");
    for (const locale of ["nl", "fr", "de", "en"]) expect(accountLocale(locale)).toBe(locale);
    for (const locale of ["es", "", "NL", "nl-BE"]) {
      expect(() => accountLocale(locale), locale).toThrow(NOT_FOUND);
    }
  });

  it("are never indexed, flag on or off", async () => {
    const { accountMetadata } = await import("../src/server/account");
    setFlag(undefined);
    expect(await accountMetadata("nl", "signInTitle")).toEqual({
      robots: { index: false, follow: false },
    });
    setFlag("true");
    expect(await accountMetadata("fr", "signInTitle")).toEqual({
      title: "[signInTitle] · IGS-Pharma",
      robots: { index: false, follow: false },
    });
  });
});
