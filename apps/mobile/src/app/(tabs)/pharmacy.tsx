import { router } from "expo-router";
import { OnDutyCard, PharmacyCard } from "../../components/PharmacyCard";
import { Button, Screen } from "../../components/ui";
import { open } from "../../components/ui";
import { STOREFRONT_URL } from "../../config";
import { usePharmacy } from "../../hooks/usePharmacy";
import { useSettings } from "../../settings/SettingsContext";

export default function PharmacyScreen() {
  const { t } = useSettings();
  const pharmacy = usePharmacy();
  return (
    <Screen>
      <PharmacyCard pharmacy={pharmacy} full />
      <OnDutyCard />
      <Button
        kind="secondary"
        label={t("website")}
        accessibilityHint={t("opensBrowser")}
        onPress={() => open(STOREFRONT_URL)}
      />
      <Button kind="secondary" label={t("about")} onPress={() => router.push("/about")} />
    </Screen>
  );
}
