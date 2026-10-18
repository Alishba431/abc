// Embeds a Guest Web Player page (live video, notices, public profiles) served by the backend.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Loading } from '../components/ui';
import { getServerUrl } from '../config';
import { theme } from '../theme';

export default function WebScreen({ route }) {
  const [base, setBase] = useState(null);
  useEffect(() => { getServerUrl().then(setBase); }, []);
  if (!base) return <Loading label="Opening…" />;
  const { path, url, video } = route.params;
  const source = video
    ? { html: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#000">
<video src="${base}${video}" controls autoplay playsinline style="width:100%;height:100vh" aria-label="Replay video"></video>`, baseUrl: base }
    : { uri: url || base + path };
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <WebView source={source} originWhitelist={['*']} style={{ backgroundColor: theme.bg }}
        allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="grant"
        startInLoadingState renderLoading={() => <Loading label="Loading…" />} />
    </View>
  );
}
