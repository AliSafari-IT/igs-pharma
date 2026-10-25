import { Switch, View } from "react-native";
import type { ApiErrorKind } from "../api/client";
import type { ListSort, Listing as ListingData } from "../api/types";
import type { StringKey } from "../i18n/strings";
import { useSettings } from "../settings/SettingsContext";
import { spacing } from "../theme/tokens";
import { ProductRow } from "./product";
import { Loading, Problem } from "./states";
import { AppText, Button, styles } from "./ui";

const SORT_LABELS: Record<ListSort, StringKey> = {
  relevance: "sortRelevance",
  name: "sortName",
  price_asc: "sortPriceAsc",
  price_desc: "sortPriceDesc",
  latest: "sortLatest",
};

export interface ListingControls {
  sorts: readonly ListSort[];
  sort: ListSort;
  onSort: (sort: ListSort) => void;
  inStockOnly: boolean;
  onInStockOnly: (value: boolean) => void;
  onPage: (page: number) => void;
}

/** Sort, "in stock only", the product cards and the pager, for a category or a search. */
export function Listing({
  result,
  controls,
  onRetry,
  empty,
}: {
  result:
    | { state: "loading" }
    | { state: "ready"; data: ListingData }
    | { state: "error"; kind: ApiErrorKind };
  controls: ListingControls;
  onRetry: () => void;
  empty: React.ReactNode;
}) {
  const { palette, t } = useSettings();
  return (
    <>
      <View style={{ gap: spacing.sm }}>
        <AppText variant="small" muted>
          {t("sortLabel")}
        </AppText>
        <View style={styles.row}>
          {controls.sorts.map((sort) => (
            <Button
              key={sort}
              kind={controls.sort === sort ? "primary" : "secondary"}
              label={t(SORT_LABELS[sort])}
              onPress={() => controls.onSort(sort)}
            />
          ))}
        </View>
        <View style={[styles.row, { justifyContent: "space-between", flexWrap: "nowrap" }]}>
          <AppText>{t("inStockOnly")}</AppText>
          <Switch
            accessibilityLabel={t("inStockOnly")}
            value={controls.inStockOnly}
            onValueChange={controls.onInStockOnly}
            trackColor={{ true: palette.primary, false: palette.border }}
          />
        </View>
      </View>
      {result.state === "loading" && <Loading />}
      {result.state === "error" && <Problem kind={result.kind} onRetry={onRetry} />}
      {result.state === "ready" && (
        <>
          <AppText muted>
            {result.data.total === 1
              ? t("productCountOne")
              : t("productCountOther", { count: result.data.total })}
          </AppText>
          {result.data.items.length === 0 && empty}
          {result.data.items.map((item) => (
            <ProductRow
              key={item.cnk}
              cnk={item.cnk}
              name={item.name}
              brandName={item.brandName}
              price={item.price}
              status={item.status}
            />
          ))}
          {result.data.pageCount > 1 && (
            <View style={[styles.rowBetween, { alignItems: "center" }]}>
              <Button
                kind="secondary"
                label={t("previous")}
                disabled={result.data.page <= 1}
                onPress={() => controls.onPage(result.data.page - 1)}
              />
              <AppText muted>
                {t("page", { page: result.data.page, pages: result.data.pageCount })}
              </AppText>
              <Button
                kind="secondary"
                label={t("next")}
                disabled={result.data.page >= result.data.pageCount}
                onPress={() => controls.onPage(result.data.page + 1)}
              />
            </View>
          )}
        </>
      )}
    </>
  );
}
