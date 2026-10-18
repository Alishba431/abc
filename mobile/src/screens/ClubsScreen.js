// Read-only club directory (viewer / organizer / admin): pick a club to see its profile and athletes.
import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import TeamBadge from '../components/TeamBadge';
import { EmptyState, Loading, Message } from '../components/ui';
import { theme } from '../theme';
import { savedLabel, useCached } from '../useCached';

export default function ClubsScreen({ navigation }) {
  const q = useCached('clubs', '/api/v1/clubs');
  if (q.loading) return <Loading label="Loading clubs…" />;
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {q.stale ? <Message kind="info" text={savedLabel(q.updatedAt)} /> : null}
      <Message text={q.error} />
      <FlatList
        data={q.data || []}
        keyExtractor={(c) => c.club_id}
        contentContainerStyle={{ padding: theme.space(2) }}
        ListEmptyComponent={<EmptyState title="No clubs yet" hint="Clubs in your organisation will appear here." />}
        renderItem={({ item: c }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${c.name}, home venue ${c.venue}`}
            onPress={() => navigation.navigate('ClubDetail', { clubId: c.club_id, title: c.name })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardAlt }]}>
            <TeamBadge id={c.club_id} name={c.name} size={44} />
            <View style={{ flex: 1, marginLeft: theme.space(1.5) }}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.sub}>{c.venue}</Text>
            </View>
            <Text style={styles.chev} accessibilityElementsHidden>›</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: theme.radius, padding: theme.space(2),
    marginBottom: theme.space(1.5), minHeight: theme.touch, ...theme.shadow },
  name: { color: theme.text, fontSize: theme.font.body, fontWeight: '800' },
  sub: { color: theme.muted, fontSize: theme.font.small, marginTop: 2 },
  chev: { color: theme.muted, fontSize: 28 },
});
