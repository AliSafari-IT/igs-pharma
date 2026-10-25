import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import type { Locale } from "../api/types";
import { type Translate, pickLocale, translator } from "../i18n";
import { type Palette, palettes } from "../theme/tokens";
import { DEFAULTS, STORED_AS, type Settings, parseSettings } from "./parse";

export type { Settings, ThemePreference } from "./parse";

interface SettingsValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  locale: Locale;
  t: Translate;
  palette: Palette;
  isDark: boolean;
  /** Multiplier for font sizes (on top of the phone's own font scale). */
  textScale: number;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    AsyncStorage.getItem(STORED_AS)
      .then((raw) => setSettings(parseSettings(raw)))
      .catch(() => {
        // unreadable settings are not worth an error screen: keep the defaults
      });
  }, []);

  const value = useMemo<SettingsValue>(() => {
    const isDark = settings.theme === "dark" || (settings.theme === "system" && system === "dark");
    const locale =
      settings.language === "system"
        ? pickLocale(getLocales().map((entry) => entry.languageTag))
        : settings.language;
    return {
      settings,
      update: (patch) =>
        setSettings((current) => {
          const next = { ...current, ...patch };
          AsyncStorage.setItem(STORED_AS, JSON.stringify(next)).catch(() => {});
          return next;
        }),
      locale,
      t: translator(locale),
      palette: isDark ? palettes.dark : palettes.light,
      isDark,
      textScale: settings.largeText ? 1.2 : 1,
    };
  }, [settings, system]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
