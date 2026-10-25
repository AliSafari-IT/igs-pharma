import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { api } from "../../api/client";
import type { ListSort } from "../../api/types";
import { Listing } from "../../components/Listing";
import { AppText, Button, Card, Screen, styles } from "../../components/ui";
import { useRemote } from "../../hooks/useRemote";
import { useSettings } from "../../settings/SettingsContext";

const SORTS: readonly ListSort[] = ["name", "price_asc", "price_desc", "latest"];

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { locale, t } = useSettings();
  const [sort, setSort] = useState<ListSort>("name");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [page, setPage] = useState(1);

  const tree = useRemote(`categories:${locale}`, () => api.categories(locale));
  const result = useRemote(JSON.stringify([locale, slug, sort, inStockOnly, page]), () =>
    api.products({ locale, category: slug, sort, inStockOnly, page }),
  );

  const self = tree.state === "ready" ? tree.data.find((node) => node.slug === slug) : undefined;
  const children =
    tree.state === "ready" && self ? tree.data.filter((node) => node.parentId === self.id) : [];
  const parent =
    tree.state === "ready" && self?.parentId
      ? tree.data.find((node) => node.id === self.parentId)
      : undefined;
  const title = self?.name ?? (result.state === "ready" ? result.data.category?.name : undefined);

  return (
    <Screen>
      <Stack.Screen options={{ title: title ?? t("categories") }} />
      {title && <AppText variant="big">{title}</AppText>}
      {children.length > 0 && (
        <View style={styles.row}>
          {children.map((child) => (
            <Button
              key={child.id}
              kind="secondary"
              label={`${child.name} (${child.productCount})`}
              onPress={() => router.push(`/category/${child.slug}`)}
            />
          ))}
        </View>
      )}
      <Listing
        result={result}
        onRetry={result.reload}
        controls={{
          sorts: SORTS,
          sort,
          onSort: (next) => {
            setSort(next);
            setPage(1);
          },
          inStockOnly,
          onInStockOnly: (next) => {
            setInStockOnly(next);
            setPage(1);
          },
          onPage: setPage,
        }}
        empty={
          <Card>
            <AppText>{t("noProducts")}</AppText>
          </Card>
        }
      />
      <View style={styles.row}>
        {parent && (
          <Button
            kind="secondary"
            label={parent.name}
            onPress={() => router.push(`/category/${parent.slug}`)}
          />
        )}
        <Button kind="secondary" label={t("allCategories")} onPress={() => router.navigate("/")} />
      </View>
    </Screen>
  );
}
