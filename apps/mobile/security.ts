import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { initializeSslPinning, isSslPinningAvailable } from 'react-native-ssl-public-key-pinning';
import { createClient } from '@supabase/supabase-js';
export const live = process.env.EXPO_PUBLIC_MODE === 'live';
export const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const storage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
export const supabase =
  process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ? createClient(
        process.env.EXPO_PUBLIC_SUPABASE_URL,
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        {
          auth: {
            storage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
            flowType: 'pkce',
          },
        },
      )
    : null;
export async function initializeSecurity() {
  if (!live) return;
  const current = process.env.EXPO_PUBLIC_API_PIN_CURRENT,
    backup = process.env.EXPO_PUBLIC_API_PIN_BACKUP;
  if (!API.startsWith('https:') || !current || !backup || !isSslPinningAvailable())
    throw new Error(
      'Live mode needs HTTPS, current and backup certificate pins, and a native build.',
    );
  await initializeSslPinning({
    [new URL(API).hostname]: { includeSubdomains: false, publicKeyHashes: [current, backup] },
  });
}
export async function unlock() {
  if (!live) return true;
  if (
    !(await LocalAuthentication.hasHardwareAsync()) ||
    !(await LocalAuthentication.isEnrolledAsync())
  )
    throw new Error('Enroll Face ID or a fingerprint before opening FinSight.');
  return (
    await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock FinSight',
      disableDeviceFallback: true,
    })
  ).success;
}
export async function sessionToken() {
  return (await supabase?.auth.getSession())?.data.session?.access_token || '';
}
export async function api(path: string, options: RequestInit = {}) {
  const t = await sessionToken();
  const r = await fetch(API + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: 'Bearer ' + t,
      ...options.headers,
    },
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || 'Request failed');
  return body;
}
