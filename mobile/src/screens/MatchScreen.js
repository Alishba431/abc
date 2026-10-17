import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../AuthContext';
import LivePill from '../components/LivePill';
import TeamBadge from '../components/TeamBadge';
import { Button, Card, Loading, Message } from '../components/ui';
import { money, STATUS_LABEL } from '../format';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

const EVENT = {
  match_init: ['create-outline', 'Match created'], match_start: ['flag-outline', 'Kick-off'], match_end: ['stopwatch-outline', 'Full time'],
  discipline: ['alert-circle-outline', 'Discipline'], tiebreak_winner: ['ribbon-outline', 'Tie-break winner'],
  compensation: ['arrow-undo-outline', 'Correction'], score: ['football-outline', 'Score'],
};

export default function MatchScreen({ route, navigation }) {
  const { matchId } = route.params;
  const { user } = useAuth();
  const canScore = user.role === 'league_organizer' || user.role === 'super_admin';
  const q = useCached('match:' + matchId, `/api/v1/matches/${matchId}`, { pollMs: 3000, live: matchId });
  if (q.loading) return <Loading label="Loading match…" />;
  if (!q.data) return <Message text={q.error} />;
  const m = q.data;
  const names = { [m.home.team_id]: m.home.name, [m.away.team_id]: m.away.name };
  const describe = (e) => {
    if (e.type === 'score') return `${e.payload.event_type.replace(/_/g, ' ')} — ${names[e.payload.team_id] || e.payload.team_id}`;
    if (e.type === 'compensation') return `Correction: ${e.payload.reason || 'event reversed'}`;
    return EVENT[e.type] ? EVENT[e.type][1] : e.type;
  };
  const live = m.status === 'in_progress';
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <View style={styles.board} accessibilityLabel={`${STATUS_LABEL[m.status]}. ${m.home.name} ${m.home.score}, ${m.away.name} ${m.away.score}`}>
        <View style={[styles.band, { backgroundColor: live ? theme.live : theme.accent }]} />
        <View style={{ alignItems: 'center' }}>
          {live ? <LivePill /> : <Text style={styles.status}>{STATUS_LABEL[m.status]}</Text>}
        </View>
        <View style={styles.scoreRow}>
          <View style={styles.side}>
            <TeamBadge id={m.home.team_id} name={m.home.name} size={64} />
            <Text style={styles.sideName} numberOfLines={2}>{m.home.name}</Text>
            <Text style={styles.sideTag}>HOME</Text>
          </View>
          <Text style={styles.score}>{m.home.score}<Text style={styles.dash}> : </Text>{m.away.score}</Text>
          <View style={styles.side}>
            <TeamBadge id={m.away.team_id} name={m.away.name} size={64} />
            <Text style={styles.sideName} numberOfLines={2}>{m.away.name}</Text>
            <Text style={styles.sideTag}>AWAY</Text>
          </View>
        </View>
        {m.home.overs ? <Text style={styles.overs}>Overs {m.home.overs} · {m.away.overs}</Text> : null}
        <Text style={styles.comp}>ALPHA PREMIER LEAGUE</Text>
      </View>

      {canScore ? <Button title="Record score / correct event" variant="accent" onPress={() => navigation.navigate('Scoring', { matchId })} /> : null}

      <Text style={styles.h} accessibilityRole="header">MATCH CENTRE</Text>
      <Card>
        {m.events.length === 0 ? <Text style={styles.sub}>Nothing has happened yet.</Text> : null}
        {[...m.events].reverse().map((e, i, arr) => {
          const [icon] = EVENT[e.type] || ['ellipse-outline'];
          const tint = e.type === 'score' ? theme.accent : e.type === 'compensation' ? theme.warning : theme.primaryText;
          return (
            <View key={e.event_id} style={styles.event}>
              <View style={styles.rail}>
                <View style={[styles.dot, { borderColor: tint }]}>
                  <Ionicons name={icon} size={16} color={tint} accessibilityElementsHidden />
                </View>
                {i < arr.length - 1 ? <View style={styles.line} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: 14 }}>
                <Text style={[styles.eventText, e.compensated && styles.struck]}>{describe(e)}</Text>
                {e.compensated ? <Text style={styles.tag}>Reversed</Text> : null}
              </View>
            </View>
          );
        })}
      </Card>

      {m.pinned_product ? (
        <>
          <Text style={styles.h} accessibilityRole="header">MATCHDAY STORE</Text>
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image source={require('../../assets/jersey.png')} style={styles.thumb} accessibilityLabel="Jersey photo" />
            <View style={{ flex: 1 }}>
              <Text style={styles.product}>{m.pinned_product.name}</Text>
              <Text style={styles.price}>{money(Math.min(...m.pinned_product.variants.map((v) => v.price_minor)))}</Text>
              <Button title="Shop now" onPress={() => navigation.navigate('Main', { screen: 'Store' })} />
            </View>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  board: { backgroundColor: theme.card, borderRadius: 22, paddingTop: theme.space(3), paddingBottom: theme.space(2.5),
    paddingHorizontal: theme.space(1.5), marginBottom: theme.space(2), overflow: 'hidden', ...theme.shadow },
  band: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  status: { fontSize: 12, fontWeight: '900', color: theme.navy, backgroundColor: theme.accent, letterSpacing: 1.2,
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', textTransform: 'uppercase' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space(2.5) },
  side: { flex: 1, alignItems: 'center' },
  sideName: { fontSize: 15, fontWeight: '800', textAlign: 'center', color: theme.text, marginTop: 10 },
  sideTag: { fontSize: 10, fontWeight: '900', color: theme.muted, letterSpacing: 1.5, marginTop: 2 },
  score: { fontSize: theme.font.score, fontWeight: '900', color: theme.text, marginHorizontal: 4 },
  dash: { color: theme.accent, fontSize: 40 },
  overs: { fontSize: theme.font.small, color: theme.muted, textAlign: 'center', marginTop: 8 },
  comp: { fontSize: 11, color: theme.accent, textAlign: 'center', fontWeight: '900', letterSpacing: 2, marginTop: theme.space(2) },
  sub: { fontSize: theme.font.small, color: theme.muted },
  h: { fontSize: 12, fontWeight: '900', color: theme.muted, letterSpacing: 2, marginTop: theme.space(2), marginBottom: theme.space(1) },
  event: { flexDirection: 'row' },
  rail: { width: 36, alignItems: 'center' },
  dot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.navy },
  line: { width: 2, flex: 1, backgroundColor: theme.border, marginVertical: 2 },
  eventText: { fontSize: theme.font.body, color: theme.text, fontWeight: '600', textTransform: 'capitalize', marginTop: 5, marginLeft: 6 },
  struck: { textDecorationLine: 'line-through', color: theme.muted },
  tag: { fontSize: 12, fontWeight: '800', color: theme.warning, marginLeft: 6 },
  product: { fontSize: theme.font.body, fontWeight: '800', color: theme.text },
  price: { fontSize: 18, fontWeight: '900', color: theme.accent, marginVertical: 4 },
  thumb: { width: 96, height: 96, borderRadius: 14, marginRight: theme.space(1.5), backgroundColor: theme.primarySoft },
});
