import { router } from "expo-router";
import { Switch, View } from "react-native";
import type { Locale } from "../api/types";
import { AppText, Button, Card, Screen, styles } from "../components/ui";
import { LOCALES, LOCALE_NAMES } from "../i18n";
import { type ThemePreference, useSettings } from "../settings/SettingsContext";
import { spacing } from "../theme/tokens";

export default function SettingsScreen() {
  const { settings, update, palette, t } = useSettings();
  const themes: Array<{ value: ThemePreference; label: string }> = [
    { value: "system", label: t("themeSystem") },
    { value: "light", label: t("themeLight") },
    { value: "dark", label: t("themeDark") },
  ];
  const languages: Array<{ value: Locale | "system"; label: string }> = [
    { value: "system", label: t("languageSystem") },
    ...LOCALES.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] })),
  ];
  return (
    <Screen>
      <Card>
        <AppText variant="title">{t("language")}</AppText>
        <View style={styles.row}>
          {languages.map((language) => (
            <Button
              key={language.value}
              kind={settings.language === language.value ? "primary" : "secondary"}
              label={language.label}
              onPress={() => update({ language: language.value })}
            />
          ))}
        </View>
      </Card>
      <Card>
        <AppText variant="title">{t("theme")}</AppText>
        <View style={styles.row}>
          {themes.map((theme) => (
            <Button
              key={theme.value}
              kind={settings.theme === theme.value ? "primary" : "secondary"}
              label={theme.label}
              onPress={() => update({ theme: theme.value })}
            />
          ))}
        </View>
      </Card>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <AppText>{t("largeText")}</AppText>
            <AppText variant="small" muted>
              {t("largeTextHint")}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={t("largeText")}
            value={settings.largeText}
            onValueChange={(largeText) => update({ largeText })}
            trackColor={{ true: palette.primary, false: palette.border }}
          />
        </View>
      </Card>
      <Button kind="secondary" label={t("about")} onPress={() => router.push("/about")} />
    </Screen>
  );
}
