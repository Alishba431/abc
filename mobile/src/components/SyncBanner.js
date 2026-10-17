// Always-visible connectivity indicator. Uses text + icon, never colour alone.
import NetInfo from '@react-native-community/netinfo';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)), []);
  return online;
}

export default function SyncBanner({ syncing = false, pending = 0 }) {
  const online = useOnline();
  const state = syncing ? 'syncing' : online ? 'online' : 'offline';
  const cfg = {
    online: { bg: theme.success, label: '● Online' },
    offline: { bg: theme.warning, label: '○ Offline — changes are saved on this phone' },
    syncing: { bg: theme.primary, label: '⟳ Syncing…' },
  }[state];
  return (
    <View style={[styles.bar, { backgroundColor: cfg.bg }]} accessibilityRole="summary" accessibilityLabel={`${cfg.label}. ${pending} pending`}>
      <Text style={styles.text}>{cfg.label}</Text>
      <Text style={styles.text}>{pending} pending</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.space(2), paddingVertical: 6 },
  text: { color: '#FFFFFF', fontSize: theme.font.small, fontWeight: '600' },
});
