import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, spacing, usePalette } from '../theme';

export function Screen({
  children,
  scroll = true,
  edges = ['bottom'],
}: {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
}) {
  const p = usePalette();
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.screenPad} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenPad, { flex: 1 }]}>{children}</View>
  );
  return <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: p.bg }}>{body}</SafeAreaView>;
}

export function Title({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.title, { color: p.text }]}>{children}</Text>;
}

export function Body({ children, muted, center }: { children: React.ReactNode; muted?: boolean; center?: boolean }) {
  const p = usePalette();
  return (
    <Text style={[styles.body, { color: muted ? p.textMuted : p.text }, center && { textAlign: 'center' }]}>
      {children}
    </Text>
  );
}

export function SectionHeader({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.section, { color: p.textMuted }]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }, style]}>{children}</View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  small,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  accessibilityHint?: string;
}) {
  const p = usePalette();
  const bg = { primary: p.primary, secondary: p.surfaceAlt, danger: p.danger, ghost: 'transparent' }[kind];
  const fg = { primary: p.primaryText, secondary: p.text, danger: '#FFFFFF', ghost: p.primary }[kind];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[styles.label, { color: p.textMuted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={p.offline}
        {...props}
        accessibilityLabel={label}
        style={[
          styles.input,
          { color: p.text, backgroundColor: p.surface, borderColor: error ? p.danger : p.border },
          props.style,
        ]}
      />
      {error ? <Text style={{ color: p.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, { color: disabled ? p.textMuted : p.text }]}>{title}</Text>
        {description ? <Text style={{ color: p.textMuted, fontSize: 13 }}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={title}
        trackColor={{ true: p.primary, false: p.border }}
      />
    </View>
  );
}

export function NavRow({ title, detail, onPress }: { title: string; detail?: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.rowTitle, { color: p.text, flex: 1 }]}>{title}</Text>
      {detail ? <Text style={{ color: p.textMuted, marginRight: spacing.sm }}>{detail}</Text> : null}
      <Text style={{ color: p.textMuted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

export function Divider() {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }} />;
}

export function Banner({ tone, children }: { tone: 'info' | 'warning' | 'danger'; children: React.ReactNode }) {
  const p = usePalette();
  const color = { info: p.primary, warning: p.warning, danger: p.danger }[tone];
  return (
    <View style={[styles.banner, { borderColor: color, backgroundColor: p.surface }]} accessibilityRole="alert">
      <Text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenPad: { padding: spacing.lg, gap: spacing.lg },
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  section: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
  },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 38, paddingHorizontal: spacing.md },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 50, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  banner: { borderLeftWidth: 4, borderRadius: radius.sm, padding: spacing.md },
});
