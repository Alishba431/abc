// Player home: my athlete profile, my season, next matches, Go Live (own stream key) and edit my own profile.
import React, { useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import AthleteProfileView from '../components/AthleteProfileView';
import { Button, Card, Field, Loading, Message } from '../components/ui';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

export default function MeScreen({ navigation }) {
  const { user } = useAuth();
  const q = useCached('me:' + user.id, '/api/v1/me/profile');
  const [form, setForm] = useState({ name: '', bio: '', social: '' });
  const [msg, setMsg] = useState({ kind: 'info', text: '' });
  const [live, setLive] = useState(null);
  const [liveMsg, setLiveMsg] = useState({ kind: 'info', text: '' });
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (q.data) setForm({ name: q.data.name || '', bio: q.data.bio || '', social: q.data.social || '' });
  }, [q.data]);

  if (q.loading) return <Loading label="Loading your profile…" />;
  if (!q.data) return <View style={{ flex: 1, backgroundColor: theme.bg, padding: theme.space(2) }}><Message text={q.error} /></View>;
  const p = q.data;

  const save = async () => {
    setBusy('save');
    try {
      await api(`/api/v1/players/${p.player_id}`, { method: 'PATCH', body: { name: form.name, bio: form.bio, social: form.social } });
      setMsg({ kind: 'success', text: 'Profile saved.' });
      q.reload();
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  };

  const streamAction = async (action) => {
    setBusy(action);
    try {
      const r = await api('/api/v1/me/stream-key', { method: 'POST', body: { action } });
      setLive(r.status === 'active' ? r : null);
      setLiveMsg(r.status === 'active'
        ? { kind: 'success', text: action === 'rotate' ? 'New key issued. The old key no longer works.' : 'You are ready to go live.' }
        : { kind: 'info', text: 'Stream stopped and key revoked.' });
    } catch (e) {
      setLiveMsg({ kind: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  };
  const confirm = (title, body, action) => Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: 'destructive', onPress: () => streamAction(action) }]);

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} tintColor={theme.accent} />}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <AthleteProfileView p={p} onOpenMatch={(m) => navigation.navigate('Match', { matchId: m.match_id, title: `vs ${m.opponent}` })} />

      <Text style={styles.h} accessibilityRole="header">GO LIVE</Text>
      <Card>
        <Text style={styles.p}>Broadcast from OBS, Larix or FFmpeg. Your stream key is private: anyone with it can stream as you.</Text>
        <Message kind={liveMsg.kind} text={liveMsg.text} />
        {live ? (
          <View>
            <Text style={styles.label}>RTMP server</Text>
            <Text selectable style={styles.mono}>{live.ingest_endpoints.rtmp.replace(`/${live.stream_key}`, '')}</Text>
            <Text style={styles.label}>Stream key</Text>
            <Text selectable style={styles.mono}>{live.stream_key}</Text>
            <Text style={styles.label}>WebRTC (WHIP)</Text>
            <Text selectable style={styles.mono}>{live.ingest_endpoints.webrtc}</Text>
            <Text style={styles.label}>Viewers watch at</Text>
            <Text selectable style={styles.mono}>{live.playback_url}</Text>
            <Button title="Rotate key" variant="secondary" loading={busy === 'rotate'}
              onPress={() => confirm('Rotate stream key?', 'Your current stream will be cut and the old key stops working.', 'rotate')} />
            <Button title="Stop stream & revoke key" variant="danger" loading={busy === 'revoke'}
              onPress={() => confirm('Stop streaming?', 'Your live stream ends immediately and this key is revoked.', 'revoke')} />
          </View>
        ) : (
          <Button title="Get my stream key" variant="accent" loading={busy === 'generate'} onPress={() => streamAction('generate')} />
        )}
      </Card>

      <Text style={styles.h} accessibilityRole="header">EDIT MY PROFILE</Text>
      <Card>
        <Field label="Display name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} maxLength={60} />
        <Field label="Bio" value={form.bio} onChangeText={(v) => setForm({ ...form, bio: v })} maxLength={280} multiline
          placeholder="Tell fans about yourself" />
        <Field label="Social handle" value={form.social} onChangeText={(v) => setForm({ ...form, social: v })} maxLength={60}
          autoCapitalize="none" placeholder="@yourname" />
        <Message kind={msg.kind} text={msg.text} />
        <Button title="Save profile" onPress={save} loading={busy === 'save'} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 12, fontWeight: '900', color: theme.muted, letterSpacing: 2, marginTop: theme.space(1), marginBottom: theme.space(1) },
  p: { color: theme.muted, fontSize: theme.font.small, marginBottom: theme.space(1) },
  label: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: theme.space(1) },
  mono: { color: theme.text, fontSize: theme.font.small, fontFamily: 'monospace', backgroundColor: theme.cardAlt, padding: 8, borderRadius: 8, marginTop: 4 },
});
