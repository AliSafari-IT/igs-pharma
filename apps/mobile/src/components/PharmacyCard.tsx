import { View } from "react-native";
import type { Pharmacy } from "../api/types";
import { EMERGENCY, STOREFRONT_URL } from "../config";
import { isStandIn, telUrl } from "../format";
import { useSettings } from "../settings/SettingsContext";
import { AppText, Button, Card, Notice, Row, open, styles } from "./ui";

const mapsUrl = (pharmacy: Pharmacy) =>
  `geo:0,0?q=${encodeURIComponent(
    `${pharmacy.address.street}, ${pharmacy.address.postalCode} ${pharmacy.address.city}`,
  )}`;

/**
 * The pharmacy's details with call, route and mail. Stand-in values ("[city]") are shown as on the
 * website, with the placeholder marker, and get no button: nobody dials "[phone number]".
 */
export function PharmacyCard({ pharmacy, full }: { pharmacy: Pharmacy | null; full?: boolean }) {
  const { t } = useSettings();
  if (!pharmacy) {
    return (
      <Card>
        <AppText variant="title">{t("pharmacyTitle")}</AppText>
        <Button
          kind="secondary"
          label={t("website")}
          accessibilityHint={t("opensBrowser")}
          onPress={() => open(STOREFRONT_URL)}
        />
      </Card>
    );
  }
  const real = (value: string) => !isStandIn(value);
  const address = `${pharmacy.address.street}\n${pharmacy.address.postalCode} ${pharmacy.address.city}`;
  return (
    <Card>
      <AppText variant="title">{pharmacy.name}</AppText>
      {pharmacy.isPlaceholder && <Notice tone="warn">{t("placeholderNote")}</Notice>}
      <Row label={t("address")} value={address} />
      <Row label={t("openingHours")} value={pharmacy.openingHours} />
      {full && (
        <>
          <Row label={t("phone")} value={pharmacy.phone} />
          <Row label={t("email")} value={pharmacy.email} />
          <Row label={t("pharmacistTitular")} value={pharmacy.pharmacistTitular} />
          <Row label={t("authorisationNumber")} value={pharmacy.authorisationNumber} />
        </>
      )}
      <View style={styles.row}>
        {real(pharmacy.phone) && (
          <Button label={t("callPharmacy")} onPress={() => open(telUrl(pharmacy.phone))} />
        )}
        {real(pharmacy.address.street) && real(pharmacy.address.city) && (
          <Button kind="secondary" label={t("route")} onPress={() => open(mapsUrl(pharmacy))} />
        )}
        {full && real(pharmacy.email) && (
          <Button
            kind="secondary"
            label={t("email")}
            onPress={() => open(`mailto:${pharmacy.email}`)}
          />
        )}
      </View>
    </Card>
  );
}

/** Pharmacy on duty and emergency numbers: needed most when the pharmacy is closed. */
export function OnDutyCard() {
  const { t } = useSettings();
  return (
    <Card>
      <AppText variant="title">{t("onDutyTitle")}</AppText>
      <AppText muted>{t("onDutyBody", { phone: EMERGENCY.onDutyPhone })}</AppText>
      <View style={styles.row}>
        <Button
          kind="secondary"
          label={t("onDutyCall", { phone: EMERGENCY.onDutyPhone })}
          onPress={() => open(telUrl(EMERGENCY.onDutyPhone))}
        />
        <Button
          kind="secondary"
          label="apotheek.be"
          accessibilityHint={t("opensBrowser")}
          onPress={() => open(EMERGENCY.onDutyWeb)}
        />
      </View>
      <AppText variant="title">{t("emergencyTitle")}</AppText>
      <View style={styles.row}>
        <Button
          kind="secondary"
          label={t("emergencyCall", { phone: EMERGENCY.emergency })}
          onPress={() => open(telUrl(EMERGENCY.emergency))}
        />
        <Button
          kind="secondary"
          label={t("poisonCall", { phone: EMERGENCY.poisonCentre })}
          onPress={() => open(telUrl(EMERGENCY.poisonCentre))}
        />
      </View>
    </Card>
  );
}
