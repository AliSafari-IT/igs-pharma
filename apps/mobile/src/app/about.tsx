import { View } from "react-native";
import { AppText, Button, Card, Row, Screen, open, styles } from "../components/ui";
import { LEGAL_DOCS, PRIVACY_EMAIL, STOREFRONT_URL, legalUrl } from "../config";
import { intlLocale, isStandIn } from "../format";
import { usePharmacy } from "../hooks/usePharmacy";
import { useSettings } from "../settings/SettingsContext";
import { appVersion, buildDate, buildNumber } from "../version";

export default function AboutScreen() {
  const { locale, t } = useSettings();
  const pharmacy = usePharmacy();
  const built = buildDate
    ? new Date(`${buildDate}T12:00:00Z`).toLocaleDateString(intlLocale(locale), {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : undefined;
  return (
    <Screen>
      <AppText variant="big">{t("appName")}</AppText>
      <AppText>{t("aboutIntro")}</AppText>
      <Card>
        <Row
          label={t("version")}
          value={buildNumber ? `${appVersion} (${buildNumber})` : appVersion}
        />
        {built && <Row label={t("buildDate")} value={built} />}
        <Row label={t("storefront")} value={STOREFRONT_URL.replace(/^https?:\/\//, "")} />
      </Card>
      <Card>
        <AppText variant="title">{t("privacyTitle")}</AppText>
        <AppText variant="small" muted>
          {t("privacyBody")}
        </AppText>
        <View style={styles.row}>
          {LEGAL_DOCS.map((doc) => (
            <Button
              key={doc}
              kind="secondary"
              label={t(doc)}
              accessibilityHint={t("opensBrowser")}
              onPress={() => open(legalUrl(locale, doc))}
            />
          ))}
        </View>
        <Button
          kind="secondary"
          label={PRIVACY_EMAIL}
          accessibilityHint={t("privacyEmailHint")}
          onPress={() => open(`mailto:${PRIVACY_EMAIL}`)}
        />
      </Card>
      <Card>
        <AppText variant="title">{t("contact")}</AppText>
        <View style={styles.row}>
          {pharmacy && !isStandIn(pharmacy.email) && (
            <Button
              kind="secondary"
              label={pharmacy.email}
              onPress={() => open(`mailto:${pharmacy.email}`)}
            />
          )}
          <Button
            kind="secondary"
            label={t("website")}
            accessibilityHint={t("opensBrowser")}
            onPress={() => open(`${STOREFRONT_URL}/${locale}`)}
          />
        </View>
      </Card>
    </Screen>
  );
}
