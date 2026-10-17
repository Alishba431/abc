// Always-visible connectivity indicator. Uses text + icon, never colour alone.
import NetInfo from '@react-native-community/netinfo';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSync } from '../SyncContext';
import { theme } from '../theme';

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)), []);
  return online;
}

const CFG = {
  online: { bg: '#0F2A1C', fg: '#86EFAC', label: '● Online' },
  offline: { bg: '#3A2A0A', fg: '#FDE68A', label: '○ Offline — changes are saved on this phone' },
  syncing: { bg: '#172554', fg: '#BFDBFE', label: '⟳ Syncing…' },
};

export default function SyncBanner() {
  const { online, syncing, pending } = useSync();
  const cfg = CFG[syncing ? 'syncing' : online ? 'online' : 'offline'];
  return (
    <View style={[styles.bar, { backgroundColor: cfg.bg }]} accessibilityRole="summary" accessibilityLabel={`${cfg.label}. ${pending} pending`}>
      <Text style={[styles.text, { color: cfg.fg }]}>{cfg.label}</Text>
      <Text style={[styles.text, { color: cfg.fg }]}>{pending} pending</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.space(2), paddingVertical: 6 },
  text: { fontSize: theme.font.small, fontWeight: '700' },
});
