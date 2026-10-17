// Server address is user-editable in Settings (emulator 10.0.2.2:8080, phone = laptop LAN IP).
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'server_url';
export const DEFAULT_SERVER = 'http://10.0.2.2:8080';

export async function getServerUrl() {
  return (await AsyncStorage.getItem(KEY)) || DEFAULT_SERVER;
}

export async function setServerUrl(url) {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  await AsyncStorage.setItem(KEY, u);
  return u;
}
