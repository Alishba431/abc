// 4-way co-stream: composite HLS video, broadcasters, and the one synchronized chat room (chat-{session}).
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import LivePill from '../components/LivePill';
import TeamBadge from '../components/TeamBadge';
import { Button, Loading, Message } from '../components/ui';
import { getServerUrl } from '../config';
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

export default function CoStreamScreen({ route, navigation }) {
  const { sessionId } = route.params;
  const { user } = useAuth();
  const [base, setBase] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [note, setNote] = useState({ kind: 'info', text: '' });
  const seen = useRef(new Set());
  const room = `chat-${sessionId}`;

  const add = (m) => {
    const key = `${m.seq || m.message_id}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    setMessages((list) => [...list, m]);
  };

  useEffect(() => {
    getServerUrl().then(setBase);
    api(`/api/v1/public/costream/${sessionId}`, { auth: false }).then(setSession).catch((e) => setError(e.message));
    api(`/api/v1/public/chat/${room}`, { auth: false }).then((r) => r.messages.forEach(add)).catch(() => {});
    return subscribe(`/ws/chat/${room}`, (msg) => { if (msg.type === 'chat.message') add(msg.data); });
  }, [sessionId]);

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
            <View key={p} style={styles.person} accessibilityLabel={`${p}${p === session.active_host ? ', host' : ''}`}>
              <TeamBadge id={p} name={p.replace('player-', '').replace('-', ' ')} size={34} />
              <Text style={styles.personText} numberOfLines={1}>{p === session.active_host ? '★ host' : p.replace('player-', '')}</Text>
            </View>
          ))}
        </View>
      </View>
      <Text style={styles.h}>LIVE CHAT</Text>
      <FlatList style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.space(2) }} data={messages}
        keyExtractor={(m) => String(m.seq || m.message_id)}
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
        <View style={{ padding: theme.space(2) }}><Button title="Sign in to chat" onPress={() => navigation.navigate('Login')} /></View>
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
  h: { fontSize: 12, fontWeight: '900', color: theme.muted, letterSpacing: 2, margin: theme.space(2), marginBottom: theme.space(1) },
  msg: { color: theme.text, fontSize: theme.font.body, paddingVertical: 6 },
  sender: { color: theme.accent, fontWeight: '800' },
  compose: { flexDirection: 'row', alignItems: 'center', padding: theme.space(1.5), gap: 8, borderTopWidth: 1, borderTopColor: theme.border },
  input: { flex: 1, minHeight: theme.touch, borderRadius: theme.radius, backgroundColor: theme.cardAlt, color: theme.text, paddingHorizontal: 12 },
});
