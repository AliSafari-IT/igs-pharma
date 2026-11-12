import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { api } from "../../api/client";
import { ProductRow } from "../../components/product";
import { AppText, Button, Card, Screen, open, styles } from "../../components/ui";
import { Loading, Problem } from "../../components/states";
import { intlLocale } from "../../format";
import { useList } from "../../list/ListContext";
import { useRemote } from "../../hooks/useRemote";
import { useSettings } from "../../settings/SettingsContext";

/** My list: on the phone only, works offline; show it at the counter or order on the website. */
export default function ListScreen() {
  const { locale, t } = useSettings();
  const { saved, remove, clear } = useList();
  const [orderTrigger, setOrderTrigger] = useState(0);
  const orderResult = useRemote(
    orderTrigger > 0 ? `order:${orderTrigger}` : null,
    () => api.listLink(saved.map((entry) => entry.cnk).slice(0, 30), locale),
  );

  useEffect(() => {
    if (orderResult.state === "ready") {
      open(orderResult.data.url);
      setOrderTrigger(0);
    }
  }, [orderResult]);

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

  if (orderTrigger > 0 && orderResult.state === "loading") {
    return <Loading />;
  }
  if (orderTrigger > 0 && orderResult.state === "error") {
    return (
      <Screen>
        <Problem kind={orderResult.kind} onRetry={() => setOrderTrigger((n) => n + 1)} />
        <Button kind="secondary" label={t("tabList")} onPress={() => setOrderTrigger(0)} />
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
        label={t("orderMyList")}
        accessibilityHint={t("orderMyListHint")}
        onPress={() => setOrderTrigger((n) => n + 1)}
      />
      <AppText variant="small" muted>
        {t("orderMyListHint")}
      </AppText>
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
