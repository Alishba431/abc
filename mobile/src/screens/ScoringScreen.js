// League Organizer: append score events and compensating (correction) events. Works offline via the queue.
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Loading, Message } from '../components/ui';
import { useSync } from '../SyncContext';
import { theme } from '../theme';
import { useCached } from '../useCached';

const pretty = (s) => s.replace(/_/g, ' ');

export default function ScoringScreen({ route }) {
  const { matchId } = route.params;
  const q = useCached('match:' + matchId, `/api/v1/matches/${matchId}`);
  const { enqueue, newId } = useSync();
  const [team, setTeam] = useState(null);
  const [msg, setMsg] = useState({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);
  if (q.loading) return <Loading label="Loading match…" />;
  if (!q.data) return <Message text={q.error} />;
  const m = q.data;
  const teamId = team || m.home.team_id;
  const name = { [m.home.team_id]: m.home.name, [m.away.team_id]: m.away.name };

  const submit = async (type, payload, label) => {
    setBusy(true);
    try {
      const r = await enqueue({
        type: 'score_event', baseVersion: m.version, label,
        payload: { event_id: newId('evt'), match_id: matchId, type, payload },
      });
      if (r.status === 'pending') setMsg({ kind: 'info', text: `Saved on this phone. "${label}" will sync when you're back online.` });
      else if (r.status === 'rejected') setMsg({ kind: 'error', text: r.result.note });
      else setMsg({ kind: 'success', text: `${label} recorded.` });
      q.reload();
    } finally {
      setBusy(false);
    }
  };

  const reverse = (e) => Alert.alert('Reverse this event?', `"${pretty(e.payload.event_type)}" for ${name[e.payload.team_id]} will be cancelled. The original stays in the history.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Reverse', style: 'destructive', onPress: () => submit('compensation', { compensates: e.event_id, reason: 'Corrected by organizer' }, `Correction: ${pretty(e.payload.event_type)}`) },
  ]);

  const active = m.events.filter((e) => e.type === 'score' && !e.compensated).reverse();
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}>
      <Card style={{ alignItems: 'center' }}>
        <Text style={styles.score}>{m.home.score} – {m.away.score}</Text>
        <Text style={styles.sub}>{m.status === 'in_progress' ? 'Match is live' : 'Scores can only be added while the match is live'}</Text>
      </Card>
      <Message kind={msg.kind} text={msg.text} />
      <Text style={styles.h}>1. Choose team</Text>
      <View style={styles.row}>
        {[m.home, m.away].map((t) => (
          <View key={t.team_id} style={{ flex: 1, marginHorizontal: 4 }}>
            <Button title={(teamId === t.team_id ? '✓ ' : '') + t.name} variant={teamId === t.team_id ? 'primary' : 'secondary'}
              onPress={() => setTeam(t.team_id)} />
          </View>
        ))}
      </View>
      <Text style={styles.h}>2. Record event</Text>
      {m.scoring_events.map((et) => (
        <Button key={et} title={`+ ${pretty(et)}`} loading={busy} onPress={() => submit('score', { team_id: teamId, event_type: et }, `${pretty(et)} — ${name[teamId]}`)} />
      ))}
      <Text style={styles.h}>Correct a mistake</Text>
      <Card>
        {active.length === 0 ? <Text style={styles.sub}>No scoring events to correct.</Text> : active.map((e) => (
          <View key={e.event_id} style={styles.event}>
            <Text style={styles.eventText}>{pretty(e.payload.event_type)} — {name[e.payload.team_id]}</Text>
            <Button title="Reverse" variant="secondary" onPress={() => reverse(e)} accessibilityHint="Adds a correction event" />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  score: { fontSize: theme.font.score, fontWeight: '800', color: theme.text },
  sub: { fontSize: theme.font.small, color: theme.muted, textAlign: 'center' },
  h: { fontSize: 18, fontWeight: '700', color: theme.text, marginTop: theme.space(2), marginBottom: theme.space(1) },
  row: { flexDirection: 'row' },
  event: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#EEF0F4' },
  eventText: { flex: 1, fontSize: theme.font.body, color: theme.text, textTransform: 'capitalize' },
});
