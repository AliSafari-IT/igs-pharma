import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSettings } from "../settings/SettingsContext";
import { spacing } from "../theme/tokens";

function HeaderButton({
  glyph,
  label,
  onPress,
}: { glyph: string; label: string; onPress: () => void }) {
  const { palette } = useSettings();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: palette.onHeader, fontSize: 20 }}>{glyph}</Text>
    </Pressable>
  );
}

/** The quick theme toggle and Settings, in the charcoal header of every tab. */
export function HeaderActions() {
  const { isDark, update, t } = useSettings();
  return (
    <View style={{ flexDirection: "row", gap: spacing.xs, marginRight: spacing.sm }}>
      <HeaderButton
        glyph={isDark ? "☀" : "☾"}
        label={isDark ? t("switchToLight") : t("switchToDark")}
        onPress={() => update({ theme: isDark ? "light" : "dark" })}
      />
      <HeaderButton glyph="⚙" label={t("settings")} onPress={() => router.push("/settings")} />
    </View>
  );
}
