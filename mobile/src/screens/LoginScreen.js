import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../AuthContext';
import { Button, Field, Message } from '../components/ui';
import { theme } from '../theme';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
          <Image source={require('../../assets/icon.png')} style={styles.logo} accessibilityLabel="League Ops logo" />
          <Text style={styles.brand} accessibilityRole="header">League Ops</Text>
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
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: theme.navy, alignItems: 'center', paddingTop: theme.space(6), paddingBottom: theme.space(7) },
  logo: { width: 96, height: 96, borderRadius: 22, marginBottom: theme.space(2) },
  brand: { fontSize: 34, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },
  tagline: { fontSize: theme.font.small, color: theme.accent, fontWeight: '700', marginTop: 6 },
  sheet: { flex: 1, backgroundColor: theme.bg, marginTop: -theme.space(3), borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: theme.space(3) },
  sub: { fontSize: 20, fontWeight: '800', color: theme.text, marginBottom: theme.space(2) },
});
