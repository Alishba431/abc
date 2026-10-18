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
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <WebView source={{ uri: base + route.params.path }} style={{ backgroundColor: theme.bg }}
        allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} startInLoadingState
        renderLoading={() => <Loading label="Loading stream…" />} />
    </View>
  );
}
