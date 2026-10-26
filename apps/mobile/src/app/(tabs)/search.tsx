import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ListSort } from "../../api/types";
import { Listing } from "../../components/Listing";
import { AppText, Button, Card, Screen, SearchBox } from "../../components/ui";
import { useRemote } from "../../hooks/useRemote";
import { useSettings } from "../../settings/SettingsContext";

const SORTS: readonly ListSort[] = ["relevance", "name", "price_asc", "price_desc"];
const MIN_QUERY = 2;

export default function SearchScreen() {
  const { locale, t } = useSettings();
  const params = useLocalSearchParams<{ q?: string }>();
  const [input, setInput] = useState(params.q ?? "");
  const [q, setQ] = useState(params.q?.trim() ?? "");
  const [sort, setSort] = useState<ListSort>("relevance");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [page, setPage] = useState(1);

  // a search started on Home arrives as a parameter
  useEffect(() => {
    if (params.q === undefined) return;
    setInput(params.q);
    setQ(params.q.trim());
    setPage(1);
  }, [params.q]);

  const ready = [...q].length >= MIN_QUERY;
  const result = useRemote(
    ready ? JSON.stringify([locale, q, sort, inStockOnly, page]) : null,
    () => api.products({ locale, q, sort, inStockOnly, page }),
  );

  const submit = () => {
    setQ(input.trim());
    setPage(1);
  };

  return (
    <Screen>
      <SearchBox value={input} onChange={setInput} onSubmit={submit} />
      <Button kind="secondary" label={t("scanButton")} onPress={() => router.push("/scan")} />
      {!ready ? (
        <AppText muted>{q.length > 0 ? t("searchTooShort") : t("searchPrompt")}</AppText>
      ) : (
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
              <AppText bold>{t("searchNoResults", { q })}</AppText>
              <AppText muted>{t("searchNoResultsHint")}</AppText>
              <Button
                kind="secondary"
                label={t("browseCategories")}
                onPress={() => router.navigate("/")}
              />
            </Card>
          }
        />
      )}
    </Screen>
  );
}
