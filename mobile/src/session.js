// Token lives in expo-secure-store (Android Keystore / iOS Keychain), never AsyncStorage.
import * as SecureStore from 'expo-secure-store';

const TOKEN = 'auth_token';
const USER = 'auth_user';

export async function saveSession(token, user) {
  await SecureStore.setItemAsync(TOKEN, token);
  await SecureStore.setItemAsync(USER, JSON.stringify(user));
}

export async function loadSession() {
  const token = await SecureStore.getItemAsync(TOKEN);
  const user = await SecureStore.getItemAsync(USER);
  return token && user ? { token, user: JSON.parse(user) } : null;
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(TOKEN);
  await SecureStore.deleteItemAsync(USER);
}
