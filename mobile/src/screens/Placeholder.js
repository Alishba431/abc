import React from 'react';
import { View } from 'react-native';
import { EmptyState } from '../components/ui';
import { theme } from '../theme';

export default function makePlaceholder(title, hint) {
  return function Placeholder() {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <EmptyState title={title} hint={hint} />
      </View>
    );
  };
}
