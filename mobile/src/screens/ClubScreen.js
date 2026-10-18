import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../AuthContext';
import { Card, EmptyState, Loading, Message } from '../components/ui';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

export default function ClubScreen({ route, navigation }) {
  const { user } = useAuth();
  const clubId = (route && route.params && route.params.clubId) || (user.club_ids && user.club_ids[0]) || 'club-alpha-1';
  const q = useCached('club:' + clubId, `/api/v1/clubs/${clubId}`);
  if (q.loading) return <Loading label="Loading club…" />;
  const c = q.data;
  if (!c) return <View style={{ flex: 1, backgroundColor: theme.bg }}><Message text={q.error} /></View>;
  const brand = (c.tenant && c.tenant.branding) || {};
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <Card style={{ borderTopWidth: 6, borderTopColor: brand.primary || theme.primary }}>
        <Text style={styles.title} accessibilityRole="header">{c.name}</Text>
        <Text style={styles.sub}>{c.tenant ? c.tenant.name : ''}</Text>
        <Text style={styles.sub}>Home venue: {c.venue.name} ({c.venue.lat.toFixed(3)}, {c.venue.lng.toFixed(3)})</Text>
        {c.social && c.social.x ? <Text style={styles.sub}>Social: {c.social.x}</Text> : null}
      </Card>
      <Text style={styles.h}>Staff</Text>
      <Card>
        {Object.entries(c.staff).map(([role, name]) => (
          <View key={role} style={styles.line}><Text style={styles.role}>{role}</Text><Text style={styles.val}>{name}</Text></View>
        ))}
      </Card>
      <Text style={styles.h}>Roster</Text>
      <Card>
        {c.roster.length === 0 ? <EmptyState title="No players registered yet" /> : c.roster.map((p) => (
          <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.position}. Open athlete profile`}
            onPress={() => navigation.navigate('Athlete', { playerId: p.id, title: p.name })} style={styles.line}>
            <Text style={styles.val}>{p.name}</Text><Text style={styles.role}>{p.position.toUpperCase()}  ›</Text>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: theme.font.title, fontWeight: '800', color: theme.text },
  sub: { fontSize: theme.font.small, color: theme.muted, marginTop: 4 },
  h: { fontSize: 18, fontWeight: '700', color: theme.text, marginVertical: theme.space(1) },
  line: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 40, alignItems: 'center' },
  role: { fontSize: theme.font.small, color: theme.muted, textTransform: 'capitalize' },
  val: { fontSize: theme.font.body, color: theme.text, fontWeight: '600' },
});
