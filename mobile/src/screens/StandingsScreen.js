import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Loading, Message } from '../components/ui';
import { QUAL_LABEL } from '../format';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

const LEAGUE = 'league-alpha-1';
const QUAL_ICON = { clinched: '✓', eliminated: '✕', still_possible: '…' };

export default function StandingsScreen() {
  const q = useCached('standings:' + LEAGUE, `/api/v1/standings/${LEAGUE}`, { pollMs: 15000 });
  if (q.loading) return <Loading label="Loading standings…" />;
  const s = q.data;
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <Message text={q.error} />
      {!s || s.table.length === 0 ? <EmptyState title="No standings yet" hint="Tables appear after the first completed match." /> : (
        <View style={styles.table}>
          <Text style={styles.caption}>Alpha Premier League · top {s.qualification_spots} qualify</Text>
          <View style={[styles.row, styles.head]}>
            <Text style={[styles.c, styles.pos]}>#</Text>
            <Text style={[styles.c, styles.name]}>Team</Text>
            <Text style={styles.c}>P</Text><Text style={styles.c}>W</Text><Text style={styles.c}>D</Text>
            <Text style={styles.c}>L</Text><Text style={styles.c}>GD</Text><Text style={[styles.c, styles.pts]}>Pts</Text>
          </View>
          {s.table.map((r) => (
            <View key={r.team_id} style={styles.row}
              accessibilityLabel={`${r.rank}. ${r.name}, ${r.points} points, ${QUAL_LABEL[r.status]}`}>
              <Text style={[styles.c, styles.pos]}>{r.rank}</Text>
              <View style={styles.name}>
                <Text style={styles.teamName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.qual}>{QUAL_ICON[r.status]} {QUAL_LABEL[r.status]}</Text>
              </View>
              <Text style={styles.c}>{r.played}</Text><Text style={styles.c}>{r.won}</Text>
              <Text style={styles.c}>{r.drawn}</Text><Text style={styles.c}>{r.lost}</Text>
              <Text style={styles.c}>{r.diff > 0 ? '+' + r.diff : r.diff}</Text>
              <Text style={[styles.c, styles.pts]}>{r.points}</Text>
            </View>
          ))}
          <Text style={styles.legend}>✓ Qualified · … In contention · ✕ Eliminated</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  table: { backgroundColor: theme.card, borderRadius: theme.radius, padding: theme.space(1), ...theme.shadow },
  caption: { fontSize: theme.font.small, color: theme.muted, padding: theme.space(1) },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: theme.touch, borderBottomWidth: 1, borderBottomColor: '#EEF0F4' },
  head: { minHeight: 36, backgroundColor: theme.primarySoft, borderRadius: 10, borderBottomWidth: 0 },
  c: { width: 30, textAlign: 'center', fontSize: theme.font.small, color: theme.text },
  pos: { width: 24, fontWeight: '700' },
  name: { flex: 1, paddingHorizontal: 4 },
  teamName: { fontSize: theme.font.small, fontWeight: '700', color: theme.text },
  qual: { fontSize: 12, color: theme.muted },
  pts: { fontWeight: '900', width: 36, color: theme.navy },
  legend: { fontSize: 12, color: theme.muted, padding: theme.space(1) },
});
