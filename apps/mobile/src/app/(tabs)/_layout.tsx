import { Tabs } from "expo-router/js-tabs";
import { HeaderActions } from "../../components/HeaderActions";
import { useList } from "../../list/ListContext";
import { useSettings } from "../../settings/SettingsContext";

/** Four tabs, words only: the labels carry the meaning and stay readable with larger text. */
export default function TabsLayout() {
  const { palette, t, textScale } = useSettings();
  const { saved } = useList();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.header },
        headerTintColor: palette.onHeader,
        headerRight: () => <HeaderActions />,
        sceneStyle: { backgroundColor: palette.background },
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: "none" },
        tabBarLabelStyle: { fontSize: 14 * textScale, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("appName"), tabBarLabel: t("tabHome") }} />
      <Tabs.Screen name="search" options={{ title: t("tabSearch") }} />
      <Tabs.Screen
        name="list"
        options={{
          title: t("tabList"),
          // a count in words: the tab bar has no icons for a badge to sit on
          tabBarLabel: saved.length > 0 ? `${t("tabList")} (${saved.length})` : t("tabList"),
        }}
      />
      <Tabs.Screen name="pharmacy" options={{ title: t("tabPharmacy") }} />
    </Tabs>
  );
}
