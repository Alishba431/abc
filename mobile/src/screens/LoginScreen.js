import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
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
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand} accessibilityRole="header">League Ops</Text>
        <Text style={styles.sub}>Sign in to manage fixtures, clubs and the store.</Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
          autoComplete="email" placeholder="you@example.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" />
        <Message text={error} />
        <Button title="Sign in" onPress={submit} loading={busy} />
        <Button title="Server settings" variant="secondary" onPress={() => navigation.navigate('Settings')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: theme.space(3), flexGrow: 1, justifyContent: 'center' },
  brand: { fontSize: 32, fontWeight: '800', color: theme.primary, marginBottom: theme.space(1) },
  sub: { fontSize: theme.font.body, color: theme.muted, marginBottom: theme.space(3) },
});
