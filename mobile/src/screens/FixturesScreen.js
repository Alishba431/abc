import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import LivePill from '../components/LivePill';
import TeamBadge from '../components/TeamBadge';
import { EmptyState, Loading, Message } from '../components/ui';
import { kickoffLabel, STATUS_LABEL } from '../format';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

const LEAGUE = 'league-alpha-1';

export default function FixturesScreen({ navigation }) {
  const q = useCached('fixtures:' + LEAGUE, `/api/v1/matches?league_id=${LEAGUE}`, { pollMs: 10000, live: true });
  if (q.loading) return <Loading label="Loading fixtures…" />;
  const all = q.data || [];
  const live = all.filter((m) => m.status === 'in_progress');
  const results = all.filter((m) => m.status === 'completed');
  const upcoming = all.filter((m) => m.status === 'upcoming');
  const open = (m) => navigation.navigate('Match', { matchId: m.match_id, title: `${m.home.name} v ${m.away.name}` });
  const label = (m) => `${m.home.name} versus ${m.away.name}, ${STATUS_LABEL[m.status]}${m.status !== 'upcoming' ? `, ${m.home.score} to ${m.away.score}` : ''}`;

  const Row = ({ m }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label(m)} onPress={() => open(m)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardAlt }]}>
      <View style={{ flex: 1 }}>
        {[m.home, m.away].map((t, i) => (
          <View key={t.team_id} style={[styles.teamLine, i === 0 && { marginBottom: 8 }]}>
            <TeamBadge id={t.team_id} name={t.name} size={28} />
            <Text style={styles.teamName} numberOfLines={1}>{t.name}</Text>
            {m.status !== 'upcoming' ? <Text style={styles.rowScore}>{t.score}</Text> : null}
          </View>
        ))}
      </View>
      <View style={styles.rowMeta}>
        {m.status === 'upcoming'
          ? <Text style={styles.kick}>{kickoffLabel(m.kickoff).replace(' · ', '\n')}</Text>
          : <Text style={styles.ft}>{m.status === 'completed' ? 'FT' : 'LIVE'}</Text>}
      </View>
    </Pressable>
  );

  const Section = ({ title, items }) => (items.length ? (
    <View style={{ marginBottom: theme.space(2) }}>
      <Text style={styles.section} accessibilityRole="header">{title}</Text>
      <View style={styles.group}>{items.map((m) => <Row key={m.match_id} m={m} />)}</View>
    </View>
  ) : null);

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} tintColor={theme.accent} />}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <Message text={q.error} />
      <Text style={styles.kicker}>ALPHA PREMIER LEAGUE</Text>
      {live.map((m) => (
        <Pressable key={m.match_id} accessibilityRole="button" accessibilityLabel={`Live now: ${label(m)}`} onPress={() => open(m)}
          style={({ pressed }) => [styles.hero, pressed && { opacity: 0.9 }]}>
          <View style={styles.heroBand} />
          <View style={styles.heroTop}><LivePill /><Text style={styles.heroHint}>Tap for live updates</Text></View>
          <View style={styles.heroBody}>
            <View style={styles.heroTeam}>
              <TeamBadge id={m.home.team_id} name={m.home.name} size={56} />
              <Text style={styles.heroName} numberOfLines={2}>{m.home.name}</Text>
            </View>
            <Text style={styles.heroScore}>{m.home.score}<Text style={styles.heroDash}> – </Text>{m.away.score}</Text>
            <View style={styles.heroTeam}>
              <TeamBadge id={m.away.team_id} name={m.away.name} size={56} />
              <Text style={styles.heroName} numberOfLines={2}>{m.away.name}</Text>
            </View>
          </View>
        </Pressable>
      ))}
      <Section title="RESULTS" items={results} />
      <Section title="UPCOMING" items={upcoming} />
      {all.length === 0 ? <EmptyState title="No matches yet" hint="Fixtures appear here once the league is scheduled." /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  kicker: { color: theme.accent, fontWeight: '900', letterSpacing: 2, fontSize: 12, marginBottom: theme.space(1.5) },
  hero: { backgroundColor: theme.card, borderRadius: 20, padding: theme.space(2), marginBottom: theme.space(3), overflow: 'hidden',
    borderWidth: 1, borderColor: '#2A1830', ...theme.shadow },
  heroBand: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: theme.live },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroHint: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  heroBody: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space(2) },
  heroTeam: { flex: 1, alignItems: 'center' },
  heroName: { color: theme.text, fontWeight: '800', fontSize: 15, textAlign: 'center', marginTop: 8 },
  heroScore: { color: theme.accent, fontSize: 46, fontWeight: '900', marginHorizontal: theme.space(1) },
  heroDash: { color: theme.muted, fontSize: 30 },
  section: { color: theme.muted, fontWeight: '900', letterSpacing: 2, fontSize: 12, marginBottom: theme.space(1) },
  group: { backgroundColor: theme.card, borderRadius: theme.radius, overflow: 'hidden', ...theme.shadow },
  row: { flexDirection: 'row', alignItems: 'center', padding: theme.space(2), borderBottomWidth: 1, borderBottomColor: theme.border, minHeight: theme.touch },
  teamLine: { flexDirection: 'row', alignItems: 'center' },
  teamName: { flex: 1, color: theme.text, fontSize: theme.font.body, fontWeight: '700', marginLeft: 10 },
  rowScore: { color: theme.text, fontSize: 20, fontWeight: '900', minWidth: 26, textAlign: 'right' },
  rowMeta: { width: 64, alignItems: 'flex-end', borderLeftWidth: 1, borderLeftColor: theme.border, marginLeft: theme.space(1.5) },
  kick: { color: theme.accent, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  ft: { color: theme.muted, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
});
