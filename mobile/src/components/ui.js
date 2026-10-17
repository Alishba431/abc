import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '../theme';

export function Button({ title, onPress, variant = 'primary', disabled, loading, accessibilityHint }) {
  const bg = variant === 'primary' ? theme.primary : variant === 'danger' ? theme.danger : theme.card;
  const fg = variant === 'secondary' ? theme.primary : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading) }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: theme.primary },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: theme.space(2) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={theme.muted} style={styles.input} {...props} />
    </View>
  );
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Message({ kind = 'error', text }) {
  if (!text) return null;
  const color = kind === 'error' ? theme.danger : kind === 'success' ? theme.success : theme.muted;
  const icon = kind === 'error' ? '⚠ ' : kind === 'success' ? '✓ ' : 'ℹ ';
  return (
    <Text accessibilityLiveRegion="polite" style={[styles.message, { color, borderColor: color }]}>
      {icon}
      {text}
    </Text>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <View style={styles.empty} accessibilityLabel={label}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={styles.emptyHint}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: theme.touch, borderRadius: theme.radius, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: theme.space(2), marginVertical: theme.space(0.5),
  },
  buttonText: { fontSize: theme.font.body, fontWeight: '600' },
  label: { fontSize: theme.font.small, color: theme.text, fontWeight: '600', marginBottom: 4 },
  input: {
    minHeight: theme.touch, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius,
    paddingHorizontal: theme.space(1.5), fontSize: theme.font.body, color: theme.text, backgroundColor: theme.card,
  },
  card: {
    backgroundColor: theme.card, borderRadius: theme.radius, padding: theme.space(2),
    marginBottom: theme.space(1.5), borderWidth: 1, borderColor: theme.border,
  },
  message: { fontSize: theme.font.small, borderWidth: 1, borderRadius: 8, padding: theme.space(1), marginVertical: theme.space(1) },
  empty: { alignItems: 'center', justifyContent: 'center', padding: theme.space(4) },
  emptyTitle: { fontSize: theme.font.body, fontWeight: '600', color: theme.text, textAlign: 'center' },
  emptyHint: { fontSize: theme.font.small, color: theme.muted, textAlign: 'center', marginTop: theme.space(1) },
});
