import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { api } from "../../api/client";
import { Availability, PriceLine } from "../../components/product";
import { Loading, Problem } from "../../components/states";
import { AppText, Button, Card, Notice, Row, Screen, open, styles } from "../../components/ui";
import { productWebUrl } from "../../config";
import { isStandIn, telUrl } from "../../format";
import { usePharmacy } from "../../hooks/usePharmacy";
import { useRemote } from "../../hooks/useRemote";
import { useList } from "../../list/ListContext";
import { useSettings } from "../../settings/SettingsContext";

/**
 * One product, as its storefront page shows it: price with VAT, availability, the approved texts
 * and, for a medicine, the neutral "read the leaflet, ask your pharmacist" notice. Ordering opens
 * the same product on the website (asafarim-docs ventures/igs-pharma/09-mobile, M-D1).
 */
export default function ProductScreen() {
  const { cnk } = useLocalSearchParams<{ cnk: string }>();
  const { locale, t } = useSettings();
  const list = useList();
  const pharmacy = usePharmacy();
  const product = useRemote(`${locale}:${cnk}`, () => api.product(cnk, locale));
  const saved = list.has(cnk);
  const { refresh } = list;

  // a saved product keeps its price and stock current when it is viewed again
  const data = product.state === "ready" ? product.data : undefined;
  useEffect(() => {
    if (data && saved) refresh(data);
  }, [data, saved, refresh]);

  if (product.state === "loading") return <Loading />;
  if (product.state === "error") {
    return (
      <Screen>
        <Problem kind={product.kind} onRetry={product.reload} />
        {saved && product.kind === "not_found" && (
          <Button kind="secondary" label={t("removeFromList")} onPress={() => list.remove(cnk)} />
        )}
      </Screen>
    );
  }
  const item = product.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: item.name }} />
      {item.breadcrumb.length > 0 && (
        <View style={styles.row}>
          {item.breadcrumb.map((category) => (
            <Button
              key={category.slug}
              kind="secondary"
              label={category.name}
              onPress={() => router.push(`/category/${category.slug}`)}
            />
          ))}
        </View>
      )}
      <AppText variant="big">{item.name}</AppText>
      <Card>
        <PriceLine price={item.price} big />
        <Availability status={item.status} />
        {item.brandName && <Row label={t("brand")} value={item.brandName} />}
        <Row label={t("cnk")} value={item.cnk} />
      </Card>
      {item.isMedicine && <Notice tone="warn">{t("medicineNotice")}</Notice>}
      <View style={{ gap: 8 }}>
        <Button
          label={t("orderOnWebsite")}
          accessibilityHint={t("orderHint")}
          onPress={() => open(productWebUrl(locale, item.cnk))}
        />
        <AppText variant="small" muted>
          {t("orderHint")}
        </AppText>
        <Button
          kind="secondary"
          label={saved ? t("removeFromList") : t("addToList")}
          onPress={() => (saved ? list.remove(item.cnk) : list.add(item))}
        />
        {pharmacy && !isStandIn(pharmacy.phone) && (
          <Button
            kind="secondary"
            label={t("callPharmacy")}
            onPress={() => open(telUrl(pharmacy.phone))}
          />
        )}
      </View>
      {item.contentLocale !== locale && <Notice>{t("untranslated")}</Notice>}
      {item.shortDescription && <AppText>{item.shortDescription}</AppText>}
      {item.description && (
        <Card>
          <AppText variant="title">{t("description")}</AppText>
          <AppText>{item.description}</AppText>
        </Card>
      )}
      {item.warnings && (
        <Card>
          <AppText variant="title">{t("warnings")}</AppText>
          <AppText>{item.warnings}</AppText>
        </Card>
      )}
    </Screen>
  );
}
