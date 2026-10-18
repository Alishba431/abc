import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/AuthContext';
import LiveToast from './src/components/LiveToast';
import SyncBanner from './src/components/SyncBanner';
import { Loading } from './src/components/ui';
import { makeLinking } from './src/linking';
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
import CoStreamScreen from './src/screens/CoStreamScreen';
import ScanScreen from './src/screens/ScanScreen';
import WebScreen from './src/screens/WebScreen';
import { SyncProvider } from './src/SyncContext';
import { theme } from './src/theme';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();


const tabIcon = (name) => ({ color, focused, size }) => (
  <Ionicons name={focused ? name : `${name}-outline`} size={size} color={color} accessibilityElementsHidden />
);

function ScanButton() {
  const navigation = useNavigation();
  return (
    <Pressable onPress={() => navigation.navigate('Scan')} accessibilityRole="button" accessibilityLabel="Scan a QR code"
      style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
      <Ionicons name="qr-code-outline" size={24} color="#FFFFFF" accessibilityElementsHidden />
    </Pressable>
  );
}

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
            options={{ tabBarIcon: tabIcon(t.icon), tabBarAccessibilityLabel: `${t.name} tab`,
              headerRight: t.name === 'Fixtures' || t.name === 'Me' ? () => <ScanButton /> : undefined }} />
        ))}
      </Tabs.Navigator>
    </View>
  );
}

const titled = (fallback) => ({ route }) => ({ title: (route.params && route.params.title) || fallback });

function Root() {
  const { user } = useAuth();
  // Screens a deep link or QR code can open are registered for guests too (no login wall).
  const shared = (
    <>
      <Stack.Screen name="Match" component={MatchScreen} options={titled('Match')} />
      <Stack.Screen name="CoStream" component={CoStreamScreen} options={{ title: 'Co-stream' }} />
      <Stack.Screen name="Web" component={WebScreen} options={titled('League Ops')} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan a QR code' }} />
    </>
  );
  return (
    <Stack.Navigator screenOptions={{
      headerStyle: { backgroundColor: theme.navy }, headerTintColor: '#FFFFFF',
      headerTitleStyle: { fontWeight: '800' }, headerShadowVisible: false, contentStyle: { backgroundColor: theme.bg },
    }}>
      {user ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Scoring" component={ScoringScreen} options={{ title: 'Record score' }} />
          <Stack.Screen name="Athlete" component={AthleteScreen} options={titled('Athlete')} />
          <Stack.Screen name="ClubDetail" component={ClubScreen} options={titled('Club')} />
          {shared}
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Server settings' }} />
          {shared}
        </>
      )}
    </Stack.Navigator>
  );
}

function Navigation() {
  const { loading, user } = useAuth();
  const signedIn = useRef(false);
  signedIn.current = !!user;
  const linking = useMemo(() => makeLinking(() => signedIn.current), []);
  if (loading) return <View style={{ flex: 1, backgroundColor: theme.bg }}><Loading label="Starting…" /></View>;
  return (
    <NavigationContainer linking={linking}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.navy }} edges={['top']}>
        <StatusBar style="light" />
        <Root />
        <LiveToast />
      </SafeAreaView>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SyncProvider>
          <Navigation />
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
