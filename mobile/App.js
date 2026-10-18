import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/AuthContext';
import SyncBanner from './src/components/SyncBanner';
import { Loading } from './src/components/ui';
import LoginScreen from './src/screens/LoginScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import FixturesScreen from './src/screens/FixturesScreen';
import MatchScreen from './src/screens/MatchScreen';
import StandingsScreen from './src/screens/StandingsScreen';
import ClubScreen from './src/screens/ClubScreen';
import StoreScreen from './src/screens/StoreScreen';
import RosterScreen from './src/screens/RosterScreen';
import ScoringScreen from './src/screens/ScoringScreen';
import SyncScreen from './src/screens/SyncScreen';
import MeScreen from './src/screens/MeScreen';
import AthleteScreen from './src/screens/AthleteScreen';
import ClubsScreen from './src/screens/ClubsScreen';
import { SyncProvider } from './src/SyncContext';
import { theme } from './src/theme';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();


const tabIcon = (name) => ({ color, focused, size }) => (
  <Ionicons name={focused ? name : `${name}-outline`} size={size} color={color} accessibilityElementsHidden />
);

// Tabs per role (RBAC): each role sees only what it can use; the first tab is that role's home.
const TAB = {
  me: { name: 'Me', component: MeScreen, icon: 'person' },
  fixtures: { name: 'Fixtures', component: FixturesScreen, icon: 'calendar' },
  standings: { name: 'Standings', component: StandingsScreen, icon: 'trophy' },
  store: { name: 'Store', component: StoreScreen, icon: 'cart' },
  club: { name: 'Club', component: ClubScreen, icon: 'shield' },
  clubs: { name: 'Clubs', component: ClubsScreen, icon: 'shield' },
  roster: { name: 'Roster', component: RosterScreen, icon: 'people' },
  sync: { name: 'Sync', component: SyncScreen, icon: 'sync' },
  settings: { name: 'Settings', component: SettingsScreen, icon: 'settings' },
};

function tabsFor(role) {
  switch (role) {
    case 'player': return [TAB.me, TAB.fixtures, TAB.standings, TAB.store, TAB.settings];
    case 'viewer': return [TAB.fixtures, TAB.standings, TAB.clubs, TAB.store, TAB.settings];
    case 'club_manager': return [TAB.roster, TAB.fixtures, TAB.standings, TAB.club, TAB.store, TAB.sync, TAB.settings];
    case 'league_organizer': return [TAB.fixtures, TAB.standings, TAB.clubs, TAB.store, TAB.sync, TAB.settings];
    default: return [TAB.fixtures, TAB.standings, TAB.clubs, TAB.roster, TAB.store, TAB.sync, TAB.settings];
  }
}

function MainTabs() {
  const { user } = useAuth();
  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <Tabs.Navigator screenOptions={{
        tabBarActiveTintColor: theme.accent, tabBarInactiveTintColor: '#7C8BA5',
        tabBarStyle: { minHeight: 64, paddingTop: 6, paddingBottom: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.navy },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        headerStyle: { backgroundColor: theme.navy }, headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '900', fontSize: 20, letterSpacing: 0.5 }, headerShadowVisible: false,
        sceneStyle: { backgroundColor: theme.bg },
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
    <Stack.Navigator screenOptions={{
      headerStyle: { backgroundColor: theme.navy }, headerTintColor: '#FFFFFF',
      headerTitleStyle: { fontWeight: '800' }, headerShadowVisible: false, contentStyle: { backgroundColor: theme.bg },
    }}>
      {user ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Match" component={MatchScreen} options={({ route }) => ({ title: route.params.title || 'Match' })} />
          <Stack.Screen name="Scoring" component={ScoringScreen} options={{ title: 'Record score' }} />
          <Stack.Screen name="Athlete" component={AthleteScreen} options={({ route }) => ({ title: route.params.title || 'Athlete' })} />
          <Stack.Screen name="ClubDetail" component={ClubScreen} options={({ route }) => ({ title: route.params.title || 'Club' })} />
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
        <SyncProvider>
        <NavigationContainer>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.navy }} edges={['top']}>
            <StatusBar style="light" />
            <Root />
          </SafeAreaView>
        </NavigationContainer>
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
