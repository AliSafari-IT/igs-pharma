import { router } from "expo-router";
import { View } from "react-native";
import type { AvailabilityStatus, Price } from "../api/types";
import { formatPrice, formatVatRate } from "../format";
import { useSettings } from "../settings/SettingsContext";
import { radius, spacing } from "../theme/tokens";
import { AppText, Card, styles } from "./ui";

const TONE = { available: "ok", low: "warn", out: "stop" } as const;

/** In stock / few left / out of stock: the words carry the meaning, the tint only helps. */
export function Availability({ status }: { status: AvailabilityStatus }) {
  const { palette, t } = useSettings();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: palette[TONE[status]],
        borderRadius: radius.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
      }}
    >
      <AppText variant="small" bold>
        {t(status)}
      </AppText>
    </View>
  );
}

export function PriceLine({ price, big }: { price: Price; big?: boolean }) {
  const { locale, t } = useSettings();
  return (
    <View style={[styles.row, { alignItems: "baseline" }]}>
      <AppText variant={big ? "big" : "title"}>{formatPrice(price.amountCents, locale)}</AppText>
      <AppText variant="small" muted>
        {t("vatIncluded", { rate: formatVatRate(price.vatRateBp, locale) })}
      </AppText>
    </View>
  );
}

/** One product in a listing, search result or My list; the whole card opens the product. */
export function ProductRow({
  cnk,
  name,
  brandName,
  price,
  status,
  footer,
}: {
  cnk: string;
  name: string;
  brandName: string | null;
  price: Price;
  status: AvailabilityStatus;
  footer?: React.ReactNode;
}) {
  return (
    <Card label={name} onPress={() => router.push(`/product/${cnk}`)}>
      <AppText bold>{name}</AppText>
      {brandName && (
        <AppText variant="small" muted>
          {brandName}
        </AppText>
      )}
      <View style={[styles.rowBetween, { alignItems: "center" }]}>
        <PriceLine price={price} />
        <Availability status={status} />
      </View>
      {footer}
    </Card>
  );
}
