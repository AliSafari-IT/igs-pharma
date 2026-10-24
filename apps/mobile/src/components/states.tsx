import { router } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import type { ApiErrorKind } from "../api/client";
import { useSettings } from "../settings/SettingsContext";
import { spacing } from "../theme/tokens";
import { AppText, Button, Card, styles } from "./ui";

export function Loading() {
  const { palette, t } = useSettings();
  return (
    <View style={{ padding: spacing.xl, alignItems: "center", gap: spacing.sm }}>
      <ActivityIndicator color={palette.primary} size="large" />
      <AppText muted>{t("loading")}</AppText>
    </View>
  );
}

/**
 * What a screen shows instead of data. Never a dead end: retry, plus My list and the pharmacy,
 * which work without the storefront.
 */
export function Problem({ kind, onRetry }: { kind: ApiErrorKind; onRetry: () => void }) {
  const { t } = useSettings();
  const [title, body] =
    kind === "closed"
      ? [t("closedTitle"), t("closedBody")]
      : kind === "offline"
        ? [t("offlineTitle"), t("offlineBody")]
        : kind === "not_found"
          ? [t("productNotFound"), t("searchNoResultsHint")]
          : [t("errorTitle"), t("errorBody")];
  return (
    <Card>
      <AppText variant="title">{title}</AppText>
      <AppText muted>{body}</AppText>
      <View style={styles.row}>
        {kind !== "not_found" && <Button label={t("retry")} onPress={onRetry} />}
        <Button kind="secondary" label={t("tabList")} onPress={() => router.navigate("/list")} />
        <Button
          kind="secondary"
          label={t("tabPharmacy")}
          onPress={() => router.navigate("/pharmacy")}
        />
      </View>
    </Card>
  );
}
