import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import LivePill from '../components/LivePill';
import { Button, Field, Message } from '../components/ui';
import { theme } from '../theme';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState([]);

  // Guests can watch what's on air without an account.
  useEffect(() => {
    let on = true;
    const load = () => api('/api/v1/public/live', { auth: false }).then((r) => on && setLive(r)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => { on = false; clearInterval(t); };
  }, []);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain"
            accessibilityRole="header" accessibilityLabel="League Ops" />
          <Text style={styles.tagline}>Fixtures · Live scores · Clubs · Store</Text>
        </View>
        <View style={styles.sheet}>
        <Text style={styles.sub}>Sign in to your account</Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
          autoComplete="email" placeholder="you@example.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" />
        <Message text={error} />
        <Button title="Sign in" onPress={submit} loading={busy} />
        <Button title="Server settings" variant="secondary" onPress={() => navigation.navigate('Settings')} />

        <Text style={styles.or}>WATCH WITHOUT AN ACCOUNT</Text>
        {live.map((m) => (
          <Pressable key={m.match_id} accessibilityRole="button"
            accessibilityLabel={`Live now: ${m.home.name} ${m.home.score}, ${m.away.name} ${m.away.score}. Watch as guest`}
            onPress={() => navigation.navigate('Match', { matchId: m.match_id, title: `${m.home.name} v ${m.away.name}` })}
            style={({ pressed }) => [styles.live, pressed && { opacity: 0.85 }]}>
            <LivePill />
            <Text style={styles.liveText} numberOfLines={1}>{m.home.name} {m.home.score} - {m.away.score} {m.away.name}</Text>
          </Pressable>
        ))}
        <Button title="Scan a QR code" variant="secondary" onPress={() => navigation.navigate('Scan')}
          accessibilityHint="Open a match, club, athlete or co-stream from its QR code" />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: theme.navy, alignItems: 'center', paddingTop: theme.space(6), paddingBottom: theme.space(7) },
  logo: { width: 180, height: 180, marginBottom: theme.space(1) },
  brand: { fontSize: 34, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },
  tagline: { fontSize: theme.font.small, color: theme.accent, fontWeight: '700', marginTop: 6 },
  sheet: { flex: 1, backgroundColor: theme.bg, marginTop: -theme.space(3), borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: theme.space(3) },
  sub: { fontSize: 20, fontWeight: '800', color: theme.text, marginBottom: theme.space(2) },
  or: { fontSize: 12, fontWeight: '900', color: theme.muted, letterSpacing: 2, marginTop: theme.space(3), marginBottom: theme.space(1) },
  live: { flexDirection: 'row', alignItems: 'center', minHeight: theme.touch, backgroundColor: theme.card, borderRadius: theme.radius,
    paddingHorizontal: theme.space(1.5), marginVertical: theme.space(0.5), borderLeftWidth: 4, borderLeftColor: theme.live },
  liveText: { flex: 1, color: theme.text, fontWeight: '800', marginLeft: theme.space(1) },
});
