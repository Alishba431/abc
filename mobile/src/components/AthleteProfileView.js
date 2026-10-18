// Read-only athlete card used by the Player's "Me" home and by everyone else's athlete page.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { kickoffLabel } from '../format';
import { theme } from '../theme';
import TeamBadge from './TeamBadge';
import { Card } from './ui';

const POSITION = { gk: 'Goalkeeper', df: 'Defender', mf: 'Midfielder', fw: 'Forward' };

export default function AthleteProfileView({ p, onOpenMatch, onOpenVod, children }) {
  const c = p.career;
  const stats = [['Played', c.played], ['Won', c.won], ['Drawn', c.drawn], ['Lost', c.lost], ['Goals for', c.scored], ['Goals against', c.conceded]];
  return (
    <View>
      <Card style={styles.hero}>
        <TeamBadge id={p.player_id} name={p.name} size={76} />
        <Text style={styles.name} accessibilityRole="header">{p.name}</Text>
        <Text style={styles.sub}>{POSITION[p.position] || p.position} · {p.club.name}</Text>
        <Text style={styles.followers}>{p.followers} {p.followers === 1 ? 'follower' : 'followers'}</Text>
        {p.bio ? <Text style={styles.bio}>{p.bio}</Text> : null}
        {p.social ? <Text style={styles.sub}>{p.social}</Text> : null}
        {children}
      </Card>

      <Text style={styles.h} accessibilityRole="header">THIS SEASON · {p.club.name.toUpperCase()}</Text>
      <Card style={styles.grid}>
        {stats.map(([label, value]) => (
          <View key={label} style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </Card>

      <Text style={styles.h} accessibilityRole="header">NEXT MATCHES</Text>
      <Card>
        {p.upcoming.length === 0 ? <Text style={styles.sub}>No upcoming matches scheduled.</Text> : p.upcoming.map((m) => (
          <Pressable key={m.match_id} accessibilityRole="button" style={styles.match}
            accessibilityLabel={`${m.home ? 'Home' : 'Away'} against ${m.opponent}`}
            onPress={() => onOpenMatch && onOpenMatch(m)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.opp}>{m.home ? 'vs' : '@'} {m.opponent}</Text>
              <Text style={styles.sub}>{m.status === 'in_progress' ? `Live now · ${m.score}` : kickoffLabel(m.kickoff)}</Text>
            </View>
            <Text style={[styles.tag, m.status === 'in_progress' && { color: theme.live }]}>{m.status === 'in_progress' ? 'LIVE' : m.home ? 'HOME' : 'AWAY'}</Text>
          </Pressable>
        ))}
      </Card>

      {p.vods && p.vods.length ? (
        <>
          <Text style={styles.h} accessibilityRole="header">REPLAYS</Text>
          <Card>
            {p.vods.map((v) => (
              <Pressable key={v.vod_id} accessibilityRole="button" style={styles.match}
                accessibilityLabel={`Replay from ${new Date(v.started_at).toLocaleString()}, ${Math.round(v.duration_s)} seconds`}
                onPress={() => onOpenVod && onOpenVod(v)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.opp}>▶ Live stream replay</Text>
                  <Text style={styles.sub}>{new Date(v.started_at).toLocaleString()} · {Math.max(1, Math.round(v.duration_s / 60))} min</Text>
                </View>
                <Text style={styles.tag}>VOD</Text>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: theme.space(3) },
  name: { color: theme.text, fontSize: 24, fontWeight: '900', marginTop: theme.space(1.5) },
  sub: { color: theme.muted, fontSize: theme.font.small, marginTop: 4, textAlign: 'center' },
  followers: { color: theme.accent, fontWeight: '800', marginTop: 6 },
  bio: { color: theme.text, fontSize: theme.font.body, marginTop: theme.space(1), textAlign: 'center' },
  h: { fontSize: 12, fontWeight: '900', color: theme.muted, letterSpacing: 2, marginTop: theme.space(1), marginBottom: theme.space(1) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 0 },
  stat: { width: '33.33%', alignItems: 'center', paddingVertical: theme.space(1) },
  statValue: { color: theme.text, fontSize: 24, fontWeight: '900' },
  statLabel: { color: theme.muted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  match: { flexDirection: 'row', alignItems: 'center', minHeight: theme.touch, borderBottomWidth: 1, borderBottomColor: theme.border, paddingVertical: 8 },
  opp: { color: theme.text, fontSize: theme.font.body, fontWeight: '800' },
  tag: { color: theme.accent, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
});
