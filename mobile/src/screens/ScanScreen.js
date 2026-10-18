// Native QR scanner: resolves League Ops short links (http://…/q/{code}) or nascon:// links to the right screen.
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Message } from '../components/ui';
import { routeForEntity } from '../linking';
import { theme } from '../theme';

export default function ScanScreen({ navigation }) {
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [msg, setMsg] = useState({ kind: 'info', text: 'Point the camera at a League Ops QR code.' });
  const busy = useRef(false);

  const onScan = async ({ data }) => {
    if (busy.current) return;
    busy.current = true;
    try {
      let type; let id;
      const deep = /^nascon:\/\/(entity|stream)\/([^/?#]+)/.exec(data);
      const short = /\/q\/([A-Za-z0-9_-]+)/.exec(data);
      if (deep) { id = decodeURIComponent(deep[2]); type = deep[1] === 'stream' || id.startsWith('cs-session-') ? 'costream' : id.split('-')[0]; }
      else if (short) { const r = await api(`/api/v1/public/qr/${short[1]}`, { auth: false }); type = r.entity_type; id = r.entity_id; }
      else throw new Error("That QR code isn't a League Ops code.");
      const [name, params] = routeForEntity(type, id, !!user);
      navigation.replace(name, params);
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
      setTimeout(() => { busy.current = false; }, 1500);
    }
  };

  if (!permission) return <View style={styles.wrap} />;
  if (!permission.granted) {
    return (
      <View style={[styles.wrap, { padding: theme.space(3), justifyContent: 'center' }]}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.p}>League Ops uses the camera only to scan match and stream QR codes.</Text>
        <Button title="Allow camera" onPress={requestPermission} />
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
      <View style={styles.frame} pointerEvents="none" accessibilityElementsHidden />
      <View style={styles.bottom}><Message kind={msg.kind} text={msg.text} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: theme.font.title, fontWeight: '900', marginBottom: theme.space(1) },
  p: { color: theme.muted, marginBottom: theme.space(2) },
  frame: { position: 'absolute', top: '25%', left: '15%', width: '70%', aspectRatio: 1, borderWidth: 3, borderColor: theme.accent, borderRadius: 20 },
  bottom: { position: 'absolute', bottom: 24, left: 16, right: 16 },
});
