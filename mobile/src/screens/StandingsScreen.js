import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import TeamBadge from '../components/TeamBadge';
import { EmptyState, Loading, Message } from '../components/ui';
import { QUAL_LABEL } from '../format';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

const LEAGUE = 'league-alpha-1';
const QUAL_ICON = { clinched: '✓', eliminated: '✕', still_possible: '•' };
const ZONE = { clinched: '#22C55E', still_possible: '#60A5FA', eliminated: '#64748B' };

export default function StandingsScreen() {
  const q = useCached('standings:' + LEAGUE, `/api/v1/standings/${LEAGUE}`, { pollMs: 15000 });
  if (q.loading) return <Loading label="Loading standings…" />;
  const s = q.data;
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} tintColor={theme.accent} />}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <Message text={q.error} />
      {!s || s.table.length === 0 ? <EmptyState title="No standings yet" hint="Tables appear after the first completed match." /> : (
        <>
          <Text style={styles.kicker}>ALPHA PREMIER LEAGUE</Text>
          <Text style={styles.title} accessibilityRole="header">League table</Text>
          <Text style={styles.caption}>Top {s.qualification_spots} qualify for the playoffs</Text>
          <View style={styles.table}>
            <View style={[styles.row, styles.head]}>
              <Text style={[styles.h, styles.pos]}>#</Text>
              <Text style={[styles.h, styles.name]}>CLUB</Text>
              <Text style={styles.h}>P</Text><Text style={styles.h}>W</Text><Text style={styles.h}>D</Text>
              <Text style={styles.h}>L</Text><Text style={styles.h}>GD</Text><Text style={[styles.h, styles.pts]}>PTS</Text>
            </View>
            {s.table.map((r, i) => (
              <View key={r.team_id} style={[styles.row, i % 2 === 1 && { backgroundColor: theme.cardAlt }]}
                accessibilityLabel={`${r.rank}. ${r.name}, ${r.points} points, ${QUAL_LABEL[r.status]}`}>
                <View style={[styles.zone, { backgroundColor: ZONE[r.status] }]} />
                <Text style={[styles.c, styles.pos]}>{r.rank}</Text>
                <View style={[styles.name, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TeamBadge id={r.team_id} name={r.name} size={26} />
                  <View style={{ marginLeft: 8, flex: 1 }}>
                    <Text style={styles.teamName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.qual}>{QUAL_ICON[r.status]} {QUAL_LABEL[r.status]}</Text>
                  </View>
                </View>
                <Text style={styles.c}>{r.played}</Text><Text style={styles.c}>{r.won}</Text>
                <Text style={styles.c}>{r.drawn}</Text><Text style={styles.c}>{r.lost}</Text>
                <Text style={styles.c}>{r.diff > 0 ? '+' + r.diff : r.diff}</Text>
                <Text style={[styles.c, styles.pts]}>{r.points}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.legend}>✓ Qualified   • In contention   ✕ Eliminated</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  kicker: { color: theme.accent, fontWeight: '900', letterSpacing: 2, fontSize: 12 },
  title: { color: theme.text, fontSize: 26, fontWeight: '900', marginTop: 4 },
  caption: { fontSize: theme.font.small, color: theme.muted, marginBottom: theme.space(2) },
  table: { backgroundColor: theme.card, borderRadius: theme.radius, overflow: 'hidden', ...theme.shadow },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingRight: 6 },
  head: { minHeight: 36, backgroundColor: theme.navy },
  zone: { width: 4, alignSelf: 'stretch', marginRight: 4 },
  h: { width: 28, textAlign: 'center', fontSize: 11, color: theme.muted, fontWeight: '900', letterSpacing: 1 },
  c: { width: 28, textAlign: 'center', fontSize: theme.font.small, color: theme.text, fontWeight: '600' },
  pos: { width: 24, fontWeight: '900' },
  name: { flex: 1, paddingHorizontal: 4 },
  teamName: { fontSize: theme.font.small, fontWeight: '800', color: theme.text },
  qual: { fontSize: 11, color: theme.muted, marginTop: 1 },
  pts: { fontWeight: '900', width: 36, color: theme.accent, fontSize: 16 },
  legend: { fontSize: 12, color: theme.muted, padding: theme.space(1.5), textAlign: 'center' },
});
