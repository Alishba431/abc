import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState } from '../components/ui';
import { useSync } from '../SyncContext';
import { theme } from '../theme';

const STATUS = {
  pending: { icon: '⏳', label: 'Pending', color: theme.warning },
  done: { icon: '✓', label: 'Synced', color: theme.success },
  rejected: { icon: '✕', label: 'Not applied', color: theme.danger },
};

export default function SyncScreen() {
  const { items, pending, syncing, online, sync, clearFinished } = useSync();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ padding: theme.space(2), paddingBottom: 0 }}>
        <Text style={styles.summary}>
          {pending} waiting · {online ? 'online' : 'offline — will sync automatically when back online'}
        </Text>
        <Button title={syncing ? 'Syncing…' : 'Sync now'} onPress={sync} loading={syncing} disabled={!online || pending === 0} />
        <Button title="Clear finished items" variant="secondary" onPress={clearFinished}
          disabled={items.every((i) => i.status === 'pending')} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.action_id}
        contentContainerStyle={{ padding: theme.space(2) }}
        ListEmptyComponent={<EmptyState title="Nothing waiting to sync" hint="Scores and roster changes made offline appear here." />}
        renderItem={({ item }) => {
          const st = STATUS[item.status];
          return (
            <Card>
              <View style={styles.row}>
                <Text style={styles.label}>{item.label}</Text>
                <Text style={[styles.badge, { color: st.color }]}>{st.icon} {st.label}</Text>
              </View>
              <Text style={styles.meta}>{item.type === 'score_event' ? 'Score' : 'Roster'} · queued {new Date(item.queued_at).toLocaleTimeString()}</Text>
              {item.result ? <Text style={[styles.note, { color: st.color }]}>{item.result.note}</Text> : null}
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: theme.font.small, color: theme.muted, marginBottom: theme.space(1) },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: theme.font.body, fontWeight: '600', color: theme.text, flex: 1, marginRight: 8 },
  badge: { fontSize: theme.font.small, fontWeight: '700' },
  meta: { fontSize: 12, color: theme.muted, marginTop: 4 },
  note: { fontSize: theme.font.small, marginTop: 6 },
});
