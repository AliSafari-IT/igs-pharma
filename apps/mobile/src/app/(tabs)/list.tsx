import { router } from "expo-router";
import { Alert, View } from "react-native";
import { ProductRow } from "../../components/product";
import { AppText, Button, Card, Screen, styles } from "../../components/ui";
import { intlLocale } from "../../format";
import { useList } from "../../list/ListContext";
import { useSettings } from "../../settings/SettingsContext";

/** My list: on the phone only, works offline; show it at the counter or order on the website. */
export default function ListScreen() {
  const { locale, t } = useSettings();
  const { saved, remove, clear } = useList();

  const date = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });

  if (saved.length === 0) {
    return (
      <Screen>
        <Card>
          <AppText variant="title">{t("listEmpty")}</AppText>
          <AppText muted>{t("listEmptyHint")}</AppText>
          <View style={styles.row}>
            <Button label={t("tabSearch")} onPress={() => router.navigate("/search")} />
            <Button
              kind="secondary"
              label={t("browseCategories")}
              onPress={() => router.navigate("/")}
            />
          </View>
        </Card>
      </Screen>
    );
  }
  return (
    <Screen>
      <AppText muted>{t("listIntro")}</AppText>
      {saved.map((entry) => (
        <ProductRow
          key={entry.cnk}
          cnk={entry.cnk}
          name={entry.name}
          brandName={entry.brandName}
          price={entry.price}
          status={entry.status}
          footer={
            <View style={[styles.rowBetween, { alignItems: "center" }]}>
              <AppText variant="small" muted style={{ flexShrink: 1 }}>
                {`${t("cnk")} ${entry.cnk} · ${t("listSavedAt", { date: date(entry.seenAt) })}`}
              </AppText>
              <Button kind="secondary" label={t("remove")} onPress={() => remove(entry.cnk)} />
            </View>
          }
        />
      ))}
      <Button
        kind="secondary"
        label={t("listClear")}
        onPress={() =>
          // the platform's own dialog (never window.confirm); the list is gone after "yes"
          Alert.alert(t("listClear"), t("listClearConfirm"), [
            { text: t("cancel"), style: "cancel" },
            { text: t("confirm"), style: "destructive", onPress: clear },
          ])
        }
      />
    </Screen>
  );
}
