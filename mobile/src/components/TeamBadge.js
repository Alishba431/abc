// Circular team crest: club colour + initials (decorative; the team name is always shown as text beside it).
import React from 'react';
import { Text, View } from 'react-native';
import { crestColor, initials } from '../theme';

export default function TeamBadge({ id, name, size = 36 }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: crestColor(id), alignItems: 'center',
        justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' }}>
      <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: size * 0.36, letterSpacing: 0.5 }}>{initials(name)}</Text>
    </View>
  );
}
