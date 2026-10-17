import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/AuthContext';
import SyncBanner from './src/components/SyncBanner';
import { Loading } from './src/components/ui';
import LoginScreen from './src/screens/LoginScreen';
import makePlaceholder from './src/screens/Placeholder';
import SettingsScreen from './src/screens/SettingsScreen';
import FixturesScreen from './src/screens/FixturesScreen';
import MatchScreen from './src/screens/MatchScreen';
import StandingsScreen from './src/screens/StandingsScreen';
import ClubScreen from './src/screens/ClubScreen';
import { theme } from './src/theme';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const Store = makePlaceholder('Store', 'The club store is coming soon.');
const Sync = makePlaceholder('Nothing waiting to sync', 'Changes you make offline are listed here.');

const tabIcon = (glyph) => ({ color }) => <Text style={{ color, fontSize: 18 }} accessibilityElementsHidden>{glyph}</Text>;

// Tabs shown per role: each role sees only what it can use.
function tabsFor(role) {
  const tabs = [
    { name: 'Fixtures', component: FixturesScreen, icon: '📅' },
    { name: 'Standings', component: StandingsScreen, icon: '🏆' },
    { name: 'Store', component: Store, icon: '🛒' },
    { name: 'Club', component: ClubScreen, icon: '🏟' },
  ];
  if (role === 'league_organizer' || role === 'club_manager' || role === 'super_admin') {
    tabs.push({ name: 'Sync', component: Sync, icon: '⟳' });
  }
  tabs.push({ name: 'Settings', component: SettingsScreen, icon: '⚙' });
  return tabs;
}

function MainTabs() {
  const { user } = useAuth();
  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <Tabs.Navigator screenOptions={{
        tabBarActiveTintColor: theme.primary, tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { minHeight: 60 }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        headerTitleStyle: { fontWeight: '700' },
      }}>
        {tabsFor(user.role).map((t) => (
          <Tabs.Screen key={t.name} name={t.name} component={t.component}
            options={{ tabBarIcon: tabIcon(t.icon), tabBarAccessibilityLabel: `${t.name} tab` }} />
        ))}
      </Tabs.Navigator>
    </View>
  );
}

function Root() {
  const { loading, user } = useAuth();
  if (loading) return <Loading label="Starting…" />;
  return (
    <Stack.Navigator>
      {user ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Match" component={MatchScreen} options={({ route }) => ({ title: route.params.title || 'Match' })} />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Server settings' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
            <StatusBar style="dark" />
            <Root />
          </SafeAreaView>
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
