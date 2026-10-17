// Club Manager: transfer / loan / release players. Works offline via the queue (Section 5.14 format).
import React, { useState } from 'react';
import { Alert, FlatList, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Field, Loading, Message } from '../components/ui';
import { useAuth } from '../AuthContext';
import { useSync } from '../SyncContext';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

const ACTIONS = { transfer: 'Transfer', loan: 'Loan', release: 'Release' };
const today = () => new Date().toISOString().slice(0, 10);

export default function RosterScreen() {
  const { user } = useAuth();
  const q = useCached('roster', '/api/v1/roster');
  const { enqueue, newId } = useSync();
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState({ kind: 'info', text: '' });
  if (q.loading) return <Loading label="Loading roster…" />;
  if (!q.data) return <Message text={q.error} />;
  const { squads, players, league_id } = q.data;
  const mySquads = squads.filter((s) => user.role === 'super_admin' || (user.club_ids || []).includes(s.club_id));
  const mine = new Set(mySquads.map((s) => s.squad_id));
  const squadName = Object.fromEntries(squads.map((s) => [s.squad_id, s.name]));
  const list = players.filter((p) => mine.has(p.squad_id));

  const open = (player, type) => {
    const other = squads.find((s) => s.squad_id !== player.squad_id);
    setForm({ player, type, to: other ? other.squad_id : null, date: today(), end: '', reason: '' });
  };

  const submit = async () => {
    const f = form;
    if (f.type === 'loan' && !/^\d{4}-\d{2}-\d{2}$/.test(f.end)) return setMsg({ kind: 'error', text: 'Enter the loan end date as YYYY-MM-DD.' });
    const label = `${ACTIONS[f.type]} ${f.player.name}${f.type !== 'release' ? ' → ' + squadName[f.to] : ''}`;
    setForm(null);
    const r = await enqueue({
      type: 'roster_transfer', baseVersion: f.player.version, label,
      payload: {
        request_id: newId('tr'), league_id, player_id: f.player.player_id, type: f.type,
        from_squad_id: f.player.squad_id, to_squad_id: f.type === 'release' ? null : f.to,
        effective_date: f.date, loan_end_date: f.type === 'loan' ? f.end : null,
        reason: f.reason || ACTIONS[f.type], requested_by: user.id,
      },
    });
    if (r.status === 'pending') setMsg({ kind: 'info', text: `Saved on this phone. "${label}" will sync when you're back online.` });
    else if (r.status === 'rejected') setMsg({ kind: 'error', text: r.result.note });
    else setMsg({ kind: 'success', text: `${label}: done.` });
    q.reload();
  };

  const confirm = () => Alert.alert(`${ACTIONS[form.type]} ${form.player.name}?`, 'This change is recorded in the permanent roster history.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: submit },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <Message kind={msg.kind} text={msg.text} />
      <FlatList
        data={list}
        keyExtractor={(p) => p.player_id}
        contentContainerStyle={{ padding: theme.space(2) }}
        ListEmptyComponent={<EmptyState title="No players in your squad" hint="Players you manage will appear here." />}
        renderItem={({ item: p }) => (
          <Card>
            <Text style={styles.name}>{p.name}</Text>
            <Text style={styles.meta}>{p.position.toUpperCase()} · {p.role.replace('_', ' ')} · {squadName[p.squad_id]}
              {p.parent_squad_id ? ` (on loan from ${squadName[p.parent_squad_id]})` : ''}</Text>
            <View style={styles.row}>
              {Object.keys(ACTIONS).map((t) => (
                <View key={t} style={{ flex: 1, marginHorizontal: 2 }}>
                  <Button title={ACTIONS[t]} variant={t === 'release' ? 'danger' : 'secondary'} onPress={() => open(p, t)} />
                </View>
              ))}
            </View>
          </Card>
        )}
      />
      <Modal visible={!!form} animationType="slide" onRequestClose={() => setForm(null)}>
        {form ? (
          <ScrollView contentContainerStyle={{ padding: theme.space(3), backgroundColor: theme.bg, flexGrow: 1 }}>
            <Text style={styles.title} accessibilityRole="header">{ACTIONS[form.type]} {form.player.name}</Text>
            {form.type !== 'release' ? (
              <>
                <Text style={styles.label}>Destination squad</Text>
                {squads.filter((s) => s.squad_id !== form.player.squad_id).map((s) => (
                  <Button key={s.squad_id} title={(form.to === s.squad_id ? '✓ ' : '') + s.name}
                    variant={form.to === s.squad_id ? 'primary' : 'secondary'} onPress={() => setForm({ ...form, to: s.squad_id })} />
                ))}
              </>
            ) : null}
            <Field label="Effective date (YYYY-MM-DD)" value={form.date} onChangeText={(v) => setForm({ ...form, date: v })} />
            {form.type === 'loan' ? (
              <Field label="Loan ends (YYYY-MM-DD)" value={form.end} onChangeText={(v) => setForm({ ...form, end: v })} placeholder="2026-12-31" />
            ) : null}
            <Field label="Reason" value={form.reason} onChangeText={(v) => setForm({ ...form, reason: v })} placeholder="Optional" />
            <Button title={`Confirm ${ACTIONS[form.type].toLowerCase()}`} variant={form.type === 'release' ? 'danger' : 'primary'} onPress={confirm} />
            <Button title="Cancel" variant="secondary" onPress={() => setForm(null)} />
          </ScrollView>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: theme.font.body, fontWeight: '700', color: theme.text },
  meta: { fontSize: theme.font.small, color: theme.muted, marginVertical: 6, textTransform: 'capitalize' },
  row: { flexDirection: 'row' },
  title: { fontSize: theme.font.title, fontWeight: '800', color: theme.text, marginBottom: theme.space(2) },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.text, marginTop: theme.space(1) },
});
