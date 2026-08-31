import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'webazi-device-id';

function randomId() {
  return 'dev_' + Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

let cached: string | null = null;

/** A random id generated once and persisted, so the backend can tell
 * "same phone logging in again" apart from "a different phone using
 * this account's credentials" (see agentsRoutes.js login handler). */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) {
    cached = existing;
    return existing;
  }
  const id = randomId();
  await AsyncStorage.setItem(KEY, id);
  cached = id;
  return id;
}
