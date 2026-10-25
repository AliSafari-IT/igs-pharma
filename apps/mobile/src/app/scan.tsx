import {
  type BarcodeScanningResult,
  type BarcodeType,
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import { router, useIsFocused } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { type ApiErrorKind, api, isApiError } from "../api/client";
import { Loading, Problem } from "../components/states";
import { AppText, Button, Card, Screen, styles } from "../components/ui";
import { readScannedCode } from "../scan/code";
import { useSettings } from "../settings/SettingsContext";
import { radius, spacing } from "../theme/tokens";

/** The codes on a pack: the linear GTIN barcodes, the GS1 DataMatrix, and GS1-128 on some labels. */
const BARCODE_TYPES: BarcodeType[] = ["ean13", "ean8", "upc_a", "upc_e", "datamatrix", "code128"];

type Step =
  | { step: "scanning" }
  | { step: "looking" }
  | { step: "not_product" }
  | { step: "unknown" }
  | { step: "error"; kind: ApiErrorKind };

/**
 * "Scan a pack" (1.1): reads the barcode or DataMatrix on a pack and opens that product. The camera
 * only reads codes; no picture is kept or sent. A GTIN is looked up on the storefront
 * (`/gtin/{gtin}` → CNK); a 7-digit code is taken as the CNK. Never a dead end: every outcome offers
 * scanning again and searching by name or CNK.
 */
export default function ScanScreen() {
  const { palette, t } = useSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const focused = useIsFocused();
  const [state, setState] = useState<Step>({ step: "scanning" });
  const [torch, setTorch] = useState(false);
  // the camera reports the same code many times a second: handle one at a time
  const busy = useRef(false);

  const again = useCallback(() => {
    busy.current = false;
    setState({ step: "scanning" });
  }, []);

  const onScanned = useCallback(async ({ data, type }: BarcodeScanningResult) => {
    if (busy.current) return;
    busy.current = true;
    const code = readScannedCode(data, type);
    if (!code) {
      setState({ step: "not_product" });
      return;
    }
    if (code.kind === "cnk") {
      router.replace(`/product/${code.cnk}`);
      return;
    }
    setState({ step: "looking" });
    try {
      const cnk = await api.cnkForGtin(code.gtin);
      router.replace(`/product/${cnk}`);
    } catch (error) {
      const kind = isApiError(error) ? error.kind : "unavailable";
      setState(kind === "not_found" ? { step: "unknown" } : { step: "error", kind });
    }
  }, []);

  const searchInstead = (
    <Button
      kind="secondary"
      label={t("scanSearchInstead")}
      onPress={() => router.navigate("/search")}
    />
  );

  if (!permission) return <Loading />;
  if (!permission.granted) {
    return (
      <Screen>
        <Card>
          <AppText variant="title">{t("scanPermissionTitle")}</AppText>
          <AppText muted>
            {permission.canAskAgain ? t("scanPermissionBody") : t("scanDenied")}
          </AppText>
          <View style={styles.row}>
            {permission.canAskAgain ? (
              <Button label={t("scanAllow")} onPress={() => requestPermission()} />
            ) : (
              <Button
                label={t("scanOpenSettings")}
                onPress={() => Linking.openSettings().catch(() => {})}
              />
            )}
            {searchInstead}
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText muted>{t("scanIntro")}</AppText>
      <View style={[local.frame, { borderColor: palette.border, backgroundColor: palette.header }]}>
        {/* the camera runs only while this screen is in front and waiting for a code */}
        {focused && state.step === "scanning" ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
            onBarcodeScanned={onScanned}
            accessibilityLabel={t("scanTitle")}
          />
        ) : null}
      </View>

      {state.step === "scanning" && (
        <View style={styles.row}>
          <Button
            kind="secondary"
            label={torch ? t("scanTorchOff") : t("scanTorchOn")}
            onPress={() => setTorch((on) => !on)}
          />
          {searchInstead}
        </View>
      )}
      {state.step === "looking" && <AppText muted>{t("scanLooking")}</AppText>}
      {(state.step === "not_product" || state.step === "unknown") && (
        <Card>
          {state.step === "unknown" ? (
            <>
              <AppText variant="title">{t("scanUnknownTitle")}</AppText>
              <AppText muted>{t("scanUnknownBody")}</AppText>
            </>
          ) : (
            <AppText>{t("scanNotProduct")}</AppText>
          )}
          <View style={styles.row}>
            <Button label={t("scanAgain")} onPress={again} />
            {searchInstead}
          </View>
        </Card>
      )}
      {state.step === "error" && <Problem kind={state.kind} onRetry={again} />}
    </Screen>
  );
}

const local = StyleSheet.create({
  frame: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
});
