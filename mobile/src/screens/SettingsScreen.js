import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { ROLE_LABEL, useAuth } from '../AuthContext';
import { Button, Card, Field, Message } from '../components/ui';
import { getServerUrl, setServerUrl } from '../config';
import { theme } from '../theme';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { getServerUrl().then(setUrl); }, []);

  const save = async () => {
    setBusy(true);
    const saved = await setServerUrl(url);
    setUrl(saved);
    try {
      const r = await fetch(saved + '/health');
      setMsg(r.ok ? { kind: 'success', text: 'Saved. The server is reachable.' }
        : { kind: 'error', text: 'Saved, but the server is not ready yet.' });
    } catch (e) {
      setMsg({ kind: 'error', text: "Saved, but the server can't be reached at that address." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}>
      <Card>
        <Text style={styles.h}>Server address</Text>
        <Text style={styles.p}>Emulator: http://10.0.2.2:8080 · Phone: http://&lt;laptop IP&gt;:8080</Text>
        <Field label="Server URL" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" />
        <Message kind={msg.kind} text={msg.text} />
        <Button title="Save and test connection" onPress={save} loading={busy} />
      </Card>
      {user ? (
        <Card>
          <Text style={styles.h}>Signed in</Text>
          <Text style={styles.p}>{user.email}</Text>
          <Text style={styles.p}>Role: {ROLE_LABEL[user.role] || user.role}</Text>
          <Button title="Sign out" variant="danger" onPress={logout} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 18, fontWeight: '700', color: theme.text, marginBottom: theme.space(1) },
  p: { fontSize: theme.font.small, color: theme.muted, marginBottom: theme.space(1) },
});
