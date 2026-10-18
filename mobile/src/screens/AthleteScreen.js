// Anyone in the organisation can view an athlete; members can follow / unfollow (viewers included).
import React, { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { api } from '../api';
import AthleteProfileView from '../components/AthleteProfileView';
import { Button, Loading, Message } from '../components/ui';
import { theme } from '../theme';
import { useCached } from '../useCached';

export default function AthleteScreen({ route, navigation }) {
  const { playerId } = route.params;
  const q = useCached('athlete:' + playerId, `/api/v1/athletes/${playerId}`);
  const [msg, setMsg] = useState({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);
  if (q.loading) return <Loading label="Loading athlete…" />;
  if (!q.data) return <View style={{ flex: 1, backgroundColor: theme.bg, padding: theme.space(2) }}><Message text={q.error} /></View>;
  const p = q.data;

  const toggle = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/v1/athletes/${playerId}/follow`, { method: 'POST', body: { follow: !p.following } });
      setMsg({ kind: 'success', text: r.following ? `You are following ${p.name}.` : `You unfollowed ${p.name}.` });
      q.reload();
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} tintColor={theme.accent} />}>
      <AthleteProfileView p={p} onOpenMatch={(m) => navigation.navigate('Match', { matchId: m.match_id, title: `vs ${m.opponent}` })}>
        <View style={{ alignSelf: 'stretch', marginTop: theme.space(2) }}>
          <Button title={p.following ? 'Following ✓  (tap to unfollow)' : 'Follow'} variant={p.following ? 'secondary' : 'accent'}
            onPress={toggle} loading={busy} />
        </View>
      </AthleteProfileView>
      <Message kind={msg.kind} text={msg.text} />
    </ScrollView>
  );
}
