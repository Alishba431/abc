// 4-way co-stream: composite HLS video, broadcasters (with host controls), and the one synchronized chat room.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import LivePill from '../components/LivePill';
import TeamBadge from '../components/TeamBadge';
import { Button, Loading, Message } from '../components/ui';
import { getServerUrl } from '../config';
import { loadSession } from '../session';
import { theme } from '../theme';
import { subscribe } from '../ws';

function playerHtml(base, sessionId) {
  const host = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  const url = `http://${host}:8888/costream/${sessionId}/index.m3u8`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:#000;height:100%}video{width:100%;height:100%;object-fit:contain}p{color:#fff;font:14px sans-serif;position:absolute;bottom:8px;width:100%;text-align:center}</style>
<script src="${base}/web/vendor/hls.min.js"></script></head><body>
<video id="v" playsinline muted autoplay controls aria-label="Co-stream video"></video><p id="n">Waiting for the broadcasters…</p>
<script>var v=document.getElementById('v');function go(){if(window.Hls&&Hls.isSupported()){var h=new Hls();h.loadSource('${url}');h.attachMedia(v);
h.on(Hls.Events.MANIFEST_PARSED,function(){document.getElementById('n').style.display='none';v.play();});
h.on(Hls.Events.ERROR,function(e,d){if(d.fatal){h.destroy();setTimeout(go,5000);}});}else{v.src='${url}';}}go();</script></body></html>`;
}

const short = (p) => p.replace('player-', '');

function SmallButton({ title, onPress, tone = theme.primaryText }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
      style={({ pressed }) => [styles.small, { borderColor: tone, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[styles.smallText, { color: tone }]}>{title}</Text>
    </Pressable>
  );
}

export default function CoStreamScreen({ route, navigation }) {
  const { sessionId, invite } = route.params;
  const { user } = useAuth();
  const [base, setBase] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [guestId, setGuestId] = useState('');
  const [note, setNote] = useState({ kind: 'info', text: '' });
  const seen = useRef(new Set());
  const room = `chat-${sessionId}`;
  const isHost = !!user && !!session && (user.role === 'super_admin' || user.player_id === session.active_host);

  const add = (m) => {
    const key = String(m.message_id || m.seq);
    if (seen.current.has(key)) return;
    seen.current.add(key);
    setMessages((list) => [...list, m]);
  };

  const load = useCallback(() => api(`/api/v1/public/costream/${sessionId}`, { auth: false })
    .then(setSession).catch((e) => setError(e.message)), [sessionId]);

  useEffect(() => {
    getServerUrl().then(setBase);
    load();
    api(`/api/v1/public/chat/${room}`, { auth: false }).then((r) => r.messages.forEach(add)).catch(() => {});
    const offChat = subscribe(`/ws/chat/${room}`, (msg) => { if (msg.type === 'chat.message') add(msg.data); });
    const offBus = subscribe('/ws', (msg) => {
      if (msg.type === 'costream.session_updated' && msg.data.session_id === sessionId) load();
    });
    return () => { offChat(); offBus(); };
  }, [sessionId]);

  // Broadcasters hold a presence socket: if this phone drops off, the server hands hosting to the next participant.
  const broadcasting = !!user && !!session && session.status === 'active' && session.active_participants.includes(user.player_id);
  useEffect(() => {
    if (!broadcasting) return undefined;
    let off = () => {};
    let cancelled = false;
    loadSession().then((s) => {
      if (cancelled || !s) return;
      off = subscribe(`/ws/costream/${sessionId}?access_token=${encodeURIComponent(s.token)}`, (msg) => {
        if (msg.type === 'costream.session_updated') load();
      });
    });
    return () => { cancelled = true; off(); };
  }, [broadcasting, sessionId]);

  // Opened from an invite link (nascon://stream/{id}?invite=…): join as a broadcaster.
  useEffect(() => {
    if (!invite) return;
    if (!user) { setNote({ kind: 'info', text: 'Sign in with the invited athlete account to join as a broadcaster.' }); return; }
    api(`/api/v1/costream/${sessionId}/join`, { method: 'POST', body: { invite_token: invite } })
      .then((s) => { setSession(s); setNote({ kind: 'success', text: "You've joined the co-stream." }); })
      .catch((e) => setNote({ kind: 'error', text: e.message }));
  }, [invite, user]);

  const control = async (action, playerId) => {
    try {
      const r = await api(`/api/v1/costream/${sessionId}/control`, { method: 'POST', body: { action, player_id: playerId } });
      if (action === 'invite') {
        setGuestId('');
        await Share.share({ message: `Join my League Ops co-stream: ${r.deep_link_uri}` });
      } else {
        setSession(r);
      }
    } catch (e) {
      setNote({ kind: 'error', text: e.message });
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    try {
      const r = await api('/api/v1/chat', { method: 'POST', body: { chat_room_id: room, text } });
      if (r.accepted === false) setNote({ kind: 'error', text: 'Not posted: too many repeated characters.' });
      else { setText(''); setNote({ kind: 'info', text: '' }); if (r.message) add({ ...r.message, chat_room_id: room }); }
    } catch (e) {
      setNote({ kind: 'error', text: e.message });
    }
  };

  if (error) return <View style={{ flex: 1, backgroundColor: theme.bg, padding: theme.space(2) }}><Message text={error} /></View>;
  if (!session || !base) return <Loading label="Joining co-stream…" />;
  const muted = new Set(session.muted_participants || []);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="costream-screen" accessibilityLabel={`Co-stream ${sessionId}`}>
      <View style={styles.video}>
        {session.status === 'active'
          ? <WebView originWhitelist={['*']} source={{ html: playerHtml(base, sessionId), baseUrl: base }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} />
          : <Text style={styles.ended}>This co-stream has ended.</Text>}
      </View>
      <View style={styles.info}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {session.status === 'active' ? <LivePill label="LIVE CO-STREAM" /> : <Text style={styles.endedTag}>ENDED</Text>}
          <Text style={styles.meta}>{session.layout.replace('_', ' ')} · {session.participant_count} on air</Text>
        </View>
        <View style={styles.people}>
          {session.active_participants.map((p) => (
            <View key={p} style={styles.person}
              accessibilityLabel={`${p}${p === session.active_host ? ', host' : ''}${muted.has(p) ? ', muted' : ''}${p === session.spotlight ? ', in spotlight' : ''}`}>
              <TeamBadge id={p} name={short(p).replace('-', ' ')} size={34} />
              <Text style={styles.personText} numberOfLines={1}>
                {p === session.active_host ? '★ host' : short(p)}{muted.has(p) ? ' 🔇' : ''}{p === session.spotlight ? ' ◎' : ''}
              </Text>
              {isHost && p !== session.active_host ? (
                <View style={styles.controls}>
                  <SmallButton title={muted.has(p) ? `Unmute ${short(p)}` : `Mute ${short(p)}`} onPress={() => control(muted.has(p) ? 'unmute' : 'mute', p)} />
                  <SmallButton title={`Spotlight ${short(p)}`} onPress={() => control('spotlight', p)} />
                  <SmallButton title={`Remove ${short(p)}`} tone={theme.dangerText} onPress={() => control('kick', p)} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
        {isHost && session.participant_count < 4 ? (
          <View style={styles.compose}>
            <TextInput value={guestId} onChangeText={setGuestId} placeholder="Athlete id to invite, e.g. player-beta-2"
              placeholderTextColor={theme.muted} style={styles.input} autoCapitalize="none" accessibilityLabel="Athlete to invite" />
            <Button title="Invite" variant="accent" onPress={() => guestId.trim() && control('invite', guestId.trim())} />
          </View>
        ) : null}
      </View>
      <Text style={styles.h}>LIVE CHAT</Text>
      <FlatList style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.space(2) }} data={messages}
        keyExtractor={(m) => String(m.message_id || m.seq)}
        ListEmptyComponent={<Text style={styles.meta}>No messages yet — say hello!</Text>}
        renderItem={({ item }) => (
          <Text style={styles.msg} accessibilityLabel={`chat: ${item.sender} says ${item.text}`}>
            <Text style={styles.sender}>{item.sender} </Text>{item.text}
          </Text>
        )} />
      <Message kind={note.kind} text={note.text} />
      {user ? (
        <View style={styles.compose}>
          <TextInput value={text} onChangeText={setText} placeholder="Say something…" placeholderTextColor={theme.muted}
            style={styles.input} accessibilityLabel="Chat message" maxLength={300} onSubmitEditing={send} />
          <Button title="Send" onPress={send} />
        </View>
      ) : (
        <View style={{ padding: theme.space(2) }}><Button title="Sign in to chat" onPress={() => (navigation.popTo ? navigation.popTo('Login') : navigation.navigate('Login'))} /></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  video: { height: 220, backgroundColor: '#000', justifyContent: 'center' },
  ended: { color: theme.text, textAlign: 'center' },
  endedTag: { color: theme.muted, fontWeight: '900', letterSpacing: 1 },
  info: { padding: theme.space(2), backgroundColor: theme.card },
  meta: { color: theme.muted, fontSize: theme.font.small },
  people: { flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.space(1.5) },
  person: { width: '25%', alignItems: 'center' },
  personText: { color: theme.text, fontSize: 12, marginTop: 4 },
  controls: { marginTop: 4, alignSelf: 'stretch', paddingHorizontal: 2 },
  small: { minHeight: theme.touch, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  smallText: { fontSize: 11, fontWeight: '800' },
  h: { fontSize: 12, fontWeight: '900', color: theme.muted, letterSpacing: 2, margin: theme.space(2), marginBottom: theme.space(1) },
  msg: { color: theme.text, fontSize: theme.font.body, paddingVertical: 6 },
  sender: { color: theme.accent, fontWeight: '800' },
  compose: { flexDirection: 'row', alignItems: 'center', padding: theme.space(1.5), gap: 8, borderTopWidth: 1, borderTopColor: theme.border },
  input: { flex: 1, minHeight: theme.touch, borderRadius: theme.radius, backgroundColor: theme.cardAlt, color: theme.text, paddingHorizontal: 12 },
});
