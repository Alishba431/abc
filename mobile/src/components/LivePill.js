// Pulsing LIVE indicator (text + dot, so meaning is not carried by colour alone).
import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { theme } from '../theme';

export default function LivePill({ label = 'LIVE' }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.live, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }} accessibilityLabel="Live now">
      <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF', marginRight: 6, opacity: pulse }} />
      <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 12, letterSpacing: 1.2 }}>{label}</Text>
    </View>
  );
}
