import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "../../api/client";
import { OnDutyCard, PharmacyCard } from "../../components/PharmacyCard";
import { Loading, Problem } from "../../components/states";
import { AppText, Button, Card, Screen, SearchBox, styles } from "../../components/ui";
import { usePharmacy } from "../../hooks/usePharmacy";
import { useRemote } from "../../hooks/useRemote";
import { useList } from "../../list/ListContext";
import { useSettings } from "../../settings/SettingsContext";
import { versionLabel } from "../../version";

export default function HomeScreen() {
  const { locale, t } = useSettings();
  const { saved } = useList();
  const pharmacy = usePharmacy();
  const [query, setQuery] = useState("");
  const categories = useRemote(`categories:${locale}`, () => api.categories(locale));

  const search = () => router.navigate({ pathname: "/search", params: { q: query.trim() } });

  return (
    <Screen>
      <AppText variant="big">{t("homeTitle")}</AppText>
      <AppText muted>{t("homeIntro")}</AppText>
      <SearchBox value={query} onChange={setQuery} onSubmit={search} />

      {saved.length > 0 && (
        <Card onPress={() => router.navigate("/list")}>
          <AppText bold>{t("tabList")}</AppText>
          <AppText muted>
            {saved.length === 1
              ? t("productCountOne")
              : t("productCountOther", { count: saved.length })}
          </AppText>
        </Card>
      )}

      <AppText variant="title">{t("categories")}</AppText>
      {categories.state === "loading" && <Loading />}
      {categories.state === "error" && (
        <Problem kind={categories.kind} onRetry={categories.reload} />
      )}
      {categories.state === "ready" && (
        <View style={styles.row}>
          {categories.data
            .filter((category) => category.depth === 1)
            .map((category) => (
              <Button
                key={category.id}
                kind="secondary"
                label={`${category.name} (${category.productCount})`}
                onPress={() => router.push(`/category/${category.slug}`)}
              />
            ))}
        </View>
      )}

      <PharmacyCard pharmacy={pharmacy} />
      <OnDutyCard />

      <Pressable accessibilityRole="link" onPress={() => router.push("/about")}>
        <AppText variant="small" muted style={{ textAlign: "center" }}>
          {`${t("appName")} ${versionLabel} · ${t("about")}`}
        </AppText>
      </Pressable>
    </Screen>
  );
}
