import React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Loading, Message } from '../components/ui';
import { kickoffLabel, STATUS_LABEL } from '../format';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

const LEAGUE = 'league-alpha-1';

export default function FixturesScreen({ navigation }) {
  const q = useCached('fixtures:' + LEAGUE, `/api/v1/matches?league_id=${LEAGUE}`, { pollMs: 10000 });
  if (q.loading) return <Loading label="Loading fixtures…" />;
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {q.stale ? <Text style={styles.stale}>{savedLabel(q.updatedAt)}</Text> : null}
      <Message text={q.error} />
      <FlatList
        data={q.data || []}
        keyExtractor={(m) => m.match_id}
        contentContainerStyle={{ padding: theme.space(2) }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
        ListEmptyComponent={<EmptyState title="No matches yet" hint="Fixtures appear here once the league is scheduled." />}
        renderItem={({ item: m }) => {
          const live = m.status === 'in_progress';
          const showScore = m.status !== 'upcoming';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${m.home.name} versus ${m.away.name}, ${STATUS_LABEL[m.status]}${showScore ? `, ${m.home.score} to ${m.away.score}` : ''}`}
              onPress={() => navigation.navigate('Match', { matchId: m.match_id, title: `${m.home.name} v ${m.away.name}` })}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.row}>
                <Text style={[styles.badge, live ? styles.live : null]}>{live ? '● ' : ''}{STATUS_LABEL[m.status]}</Text>
                <Text style={styles.time}>{kickoffLabel(m.kickoff)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.team} numberOfLines={1}>{m.home.name}</Text>
                <Text style={styles.score}>{showScore ? m.home.score : ''}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.team} numberOfLines={1}>{m.away.name}</Text>
                <Text style={styles.score}>{showScore ? m.away.score : ''}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stale: { backgroundColor: '#FEF0C7', color: theme.text, padding: theme.space(1), textAlign: 'center', fontSize: theme.font.small },
  card: { backgroundColor: theme.card, borderRadius: theme.radius, padding: theme.space(2), marginBottom: theme.space(1.5),
    minHeight: theme.touch, ...theme.shadow },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  badge: { fontSize: 11, fontWeight: '800', color: theme.primary, textTransform: 'uppercase', letterSpacing: 0.8,
    backgroundColor: theme.primarySoft, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  live: { color: '#FFFFFF', backgroundColor: theme.danger },
  time: { fontSize: theme.font.small, color: theme.muted },
  team: { fontSize: theme.font.body, color: theme.text, fontWeight: '600', flex: 1, marginRight: 8 },
  score: { fontSize: 22, fontWeight: '900', color: theme.navy, minWidth: 28, textAlign: 'right' },
});
