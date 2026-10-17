import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../AuthContext';
import { Button, Card, Loading, Message } from '../components/ui';
import { money, STATUS_LABEL } from '../format';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

const EVENT_LABEL = { match_init: 'Match created', match_start: 'Kick-off', match_end: 'Full time', discipline: 'Discipline',
  tiebreak_winner: 'Tie-break winner', compensation: 'Correction' };

export default function MatchScreen({ route, navigation }) {
  const { matchId } = route.params;
  const { user } = useAuth();
  const canScore = user.role === 'league_organizer' || user.role === 'super_admin';
  const q = useCached('match:' + matchId, `/api/v1/matches/${matchId}`, { pollMs: 3000 });
  if (q.loading) return <Loading label="Loading match…" />;
  if (!q.data) return <Message text={q.error} />;
  const m = q.data;
  const names = { [m.home.team_id]: m.home.name, [m.away.team_id]: m.away.name };
  const describe = (e) => {
    if (e.type === 'score') return `${e.payload.event_type.replace(/_/g, ' ')} — ${names[e.payload.team_id] || e.payload.team_id}`;
    if (e.type === 'compensation') return `Correction: ${e.payload.reason || 'event reversed'}`;
    return EVENT_LABEL[e.type] || e.type;
  };
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <Card style={styles.board}>
        <Text style={[styles.status, m.status === 'in_progress' && styles.liveChip]}>
          {m.status === 'in_progress' ? '● ' : ''}{STATUS_LABEL[m.status]}
        </Text>
        <View style={styles.scoreRow} accessibilityLabel={`${m.home.name} ${m.home.score}, ${m.away.name} ${m.away.score}`}>
          <Text style={styles.side} numberOfLines={2}>{m.home.name}</Text>
          <Text style={styles.score}>{m.home.score} – {m.away.score}</Text>
          <Text style={styles.side} numberOfLines={2}>{m.away.name}</Text>
        </View>
        {m.home.overs ? <Text style={[styles.sub, { color: '#CBD5E1' }]}>Overs {m.home.overs} · {m.away.overs}</Text> : null}
      </Card>

      {canScore ? <Button title="Record score / correct event" onPress={() => navigation.navigate('Scoring', { matchId })} /> : null}
      <Text style={styles.h}>Timeline</Text>
      <Card>
        {m.events.length === 0 ? <Text style={styles.sub}>Nothing has happened yet.</Text> : null}
        {[...m.events].reverse().map((e) => (
          <View key={e.event_id} style={styles.event}>
            <Text style={[styles.eventText, e.compensated && styles.struck]}>{describe(e)}</Text>
            {e.compensated ? <Text style={styles.tag}>Reversed</Text> : null}
          </View>
        ))}
      </Card>

      {m.pinned_product ? (
        <>
          <Text style={styles.h}>Featured in the store</Text>
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image source={require('../../assets/jersey.png')} style={styles.thumb} accessibilityLabel="Jersey photo" />
            <View style={{ flex: 1 }}>
            <Text style={styles.product}>{m.pinned_product.name}</Text>
            <Text style={styles.sub}>From {money(Math.min(...m.pinned_product.variants.map((v) => v.price_minor)))}</Text>
            <Button title="View in store" onPress={() => navigation.navigate('Main', { screen: 'Store' })} />
            </View>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  board: { alignItems: 'center', backgroundColor: theme.navy, paddingVertical: theme.space(3) },
  status: { fontSize: 12, fontWeight: '800', color: '#CBD5E1', textTransform: 'uppercase', letterSpacing: 1,
    backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  liveChip: { backgroundColor: theme.danger, color: '#FFFFFF' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginVertical: theme.space(2) },
  side: { flex: 1, fontSize: theme.font.body, fontWeight: '700', textAlign: 'center', color: '#FFFFFF' },
  score: { fontSize: theme.font.score, fontWeight: '900', color: theme.accent, marginHorizontal: theme.space(1) },
  sub: { fontSize: theme.font.small, color: theme.muted },
  h: { fontSize: 18, fontWeight: '700', color: theme.text, marginVertical: theme.space(1) },
  event: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEF0F4' },
  eventText: { fontSize: theme.font.body, color: theme.text, flex: 1, textTransform: 'capitalize' },
  struck: { textDecorationLine: 'line-through', color: theme.muted },
  tag: { fontSize: 12, fontWeight: '700', color: theme.warning },
  product: { fontSize: theme.font.body, fontWeight: '700', color: theme.text },
  thumb: { width: 88, height: 88, borderRadius: 12, marginRight: theme.space(1.5), backgroundColor: theme.primarySoft },
});
