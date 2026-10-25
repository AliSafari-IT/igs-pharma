import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ListProvider } from "../list/ListContext";
import { SettingsProvider, useSettings } from "../settings/SettingsContext";

function ThemedStack() {
  const { palette, t } = useSettings();
  return (
    <>
      {/* The header is always dark charcoal, so the status bar text is light. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.header },
          headerTintColor: palette.onHeader,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t("appName") }} />
        <Stack.Screen name="product/[cnk]" options={{ title: "" }} />
        <Stack.Screen name="category/[slug]" options={{ title: t("categories") }} />
        <Stack.Screen name="settings" options={{ title: t("settings") }} />
        <Stack.Screen name="about" options={{ title: t("about") }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SettingsProvider>
      <ListProvider>
        <ThemedStack />
      </ListProvider>
    </SettingsProvider>
  );
}
