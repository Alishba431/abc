// Real-time in-app notifications pushed over the WebSocket bus: score changes, co-stream invites, order updates.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { theme } from '../theme';
import { subscribe } from '../ws';

function describe(msg) {
  const d = msg.data || {};
  if (msg.type === 'match.event_appended' && d.type === 'score' && d.score) return `Score update · ${d.score.home} - ${d.score.away}`;
  if (msg.type === 'match.event_appended' && d.type === 'match_end') return 'Full time — final score is in';
  if (msg.type === 'costream.session_updated' && d.status === 'active') return `Co-stream ${d.session_id} is live · host ${d.active_host}`;
  if (msg.type === 'order.status_changed') return `Order ${d.order_id} is now ${d.to}`;
  if (msg.type === 'stream.key_revoked') return 'A live stream has ended';
  if (msg.type === 'costream.invite') return `Co-stream invite: ${d.player_id} was invited to ${d.session_id}`;
  if (msg.type === 'vod.indexed') return 'A new stream replay is ready';
  return null;
}

export default function LiveToast() {
  const [text, setText] = useState('');
  const fade = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);
  useEffect(() => subscribe('/ws', (msg) => {
    const t = describe(msg);
    if (!t) return;
    setText(t);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start(), 3500);
  }), [fade]);
  if (!text) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity: fade }]} accessibilityLiveRegion="polite">
      <Text style={styles.text} accessibilityRole="alert">🔔 {text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', top: 44, left: 16, right: 16, zIndex: 50, backgroundColor: theme.cardAlt, borderRadius: 14,
    borderLeftWidth: 4, borderLeftColor: theme.accent, padding: 14, ...theme.shadow },
  text: { color: theme.text, fontWeight: '800', fontSize: theme.font.small },
});
