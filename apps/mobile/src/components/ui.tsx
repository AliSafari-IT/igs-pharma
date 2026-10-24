import type { ReactNode } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
} from "react-native";
import { useSettings } from "../settings/SettingsContext";
import { fontSize, radius, spacing } from "../theme/tokens";

/** Opens a link in the browser, the dialer, the mail or maps app; a failure is not worth a crash. */
export function open(url: string) {
  Linking.openURL(url).catch(() => {});
}

export function Screen({ children }: { children: ReactNode }) {
  const { palette } = useSettings();
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

type Variant = "small" | "body" | "title" | "big";

export function AppText({
  children,
  variant = "body",
  muted,
  bold,
  style,
}: {
  children: ReactNode;
  variant?: Variant;
  muted?: boolean;
  bold?: boolean;
  style?: TextStyle;
}) {
  const { palette, textScale } = useSettings();
  const size = fontSize[variant] * textScale;
  const heading = variant === "title" || variant === "big";
  return (
    <Text
      accessibilityRole={heading ? "header" : "text"}
      style={[
        {
          color: muted ? palette.muted : palette.text,
          fontSize: size,
          lineHeight: size * 1.4,
          fontWeight: heading || bold ? "700" : "400",
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary";
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const { palette, textScale } = useSettings();
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? palette.primary : palette.surface,
          borderColor: primary ? palette.primary : palette.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: primary ? palette.onPrimary : palette.text,
          fontSize: fontSize.body * textScale,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Card({
  children,
  onPress,
  label,
}: { children: ReactNode; onPress?: () => void; label?: string }) {
  const { palette } = useSettings();
  const style = [styles.card, { backgroundColor: palette.surface, borderColor: palette.border }];
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      {...(label ? { accessibilityLabel: label } : {})}
      onPress={onPress}
      style={({ pressed }) => [...style, { opacity: pressed ? 0.85 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

/** A tinted box for the medicine notice, the placeholder marker and similar. */
export function Notice({
  children,
  tone = "notice",
}: { children: ReactNode; tone?: "notice" | "warn" }) {
  const { palette } = useSettings();
  return (
    <View
      accessibilityRole="text"
      style={[styles.notice, { backgroundColor: palette[tone], borderColor: palette.border }]}
    >
      {typeof children === "string" ? <AppText variant="small">{children}</AppText> : children}
    </View>
  );
}

/** A label and its value on one line, wrapping on narrow phones. */
export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowBetween}>
      <AppText muted>{label}</AppText>
      <AppText style={{ flexShrink: 1, textAlign: "right" }}>{value}</AppText>
    </View>
  );
}

export function SearchBox({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
}) {
  const { palette, textScale, t } = useSettings();
  return (
    <View style={styles.row}>
      <TextInput
        accessibilityLabel={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        placeholderTextColor={palette.muted}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        autoCorrect={false}
        maxLength={100}
        style={[
          styles.input,
          {
            color: palette.text,
            backgroundColor: palette.surface,
            borderColor: palette.border,
            fontSize: fontSize.body * textScale,
          },
        ]}
      />
      <Button label={t("searchSubmit")} onPress={onSubmit} />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  notice: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", alignItems: "center" },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    flexWrap: "wrap",
  },
  input: {
    flex: 1,
    minWidth: 180,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
});
