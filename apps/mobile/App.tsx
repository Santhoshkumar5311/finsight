import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';
import { io } from 'socket.io-client';
import Svg, { Circle } from 'react-native-svg';
import { API, api, initializeSecurity, live, sessionToken, supabase, unlock } from './security';
WebBrowser.maybeCompleteAuthSession();
const currencyLocales: Record<string, string> = { USD: 'en-US', INR: 'en-IN' };
const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat(currencyLocales[currency], { style: 'currency', currency }).format(n / 100);
type Finance = {
  summary: {
    currency: string;
    profit: number;
    income: number;
    expenses: number;
    debt: number;
    spending: { name: string; amount: number; color: string }[];
    bills: { id: string; name: string; amount: number; due: string; status: string }[];
  };
  transactions: {
    id: string;
    name: string;
    amount: number;
    date: string;
    category: string;
    currency: string;
  }[];
  diaries: { id: string; transcript: string; tags: string[]; createdAt: string }[];
  budgets: { category: string; limit: number }[];
  preferences: { leadHours: number[]; notifications: boolean };
};
export default function App() {
  const dark = useColorScheme() === 'dark';
  const colors = {
    bg: dark ? '#1d281f' : '#f7f8f3',
    panel: dark ? '#2a372c' : '#ffffff',
    text: dark ? '#dfebd7' : '#304434',
    muted: dark ? '#a1b293' : '#8b9880',
  };
  const [ready, setReady] = useState(false),
    [localEmail, setLocalEmail] = useState(''),
    [localPassword, setLocalPassword] = useState(''),
    [localSetup, setLocalSetup] = useState(false),
    [authEpoch, setAuthEpoch] = useState(0),
    [locked, setLocked] = useState(live),
    [data, setData] = useState<Finance | null>(null),
    [tab, setTab] = useState('Home'),
    [error, setError] = useState(''),
    [record, setRecord] = useState(false),
    [audioReady, setAudioReady] = useState(false),
    [reflection, setReflection] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [reply, setReply] = useState(''),
    [factor, setFactor] = useState(''),
    [secret, setSecret] = useState(''),
    [code, setCode] = useState(''),
    [leads, setLeads] = useState([72, 24, 1]),
    [wave, setWave] = useState<number[]>(Array(22).fill(4));
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
    android: { ...RecordingPresets.HIGH_QUALITY.android, audioSource: 'voice_communication' },
  });
  const recording = useAudioRecorderState(recorder, 100);
  const socket = useRef<ReturnType<typeof io> | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api('/api/dashboard'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void initializeSecurity()
      .then(() => setReady(true))
      .catch((e) => setError(e.message));
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && live) {
        setLocked(true);
        setData(null);
        setReply('');
        socket.current?.disconnect();
        supabase?.auth.stopAutoRefresh();
      } else if (state === 'active') supabase?.auth.startAutoRefresh();
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!ready || locked) return;
    void load();
    if (!live)
      void api('/config')
        .then((c) => setLocalSetup(c.setupRequired))
        .catch(() => {});
    let cancelled = false;
    void sessionToken().then((token) => {
      if (cancelled) return;
      socket.current = io(API, { auth: { token }, withCredentials: true });
      socket.current.on('dashboard:update', () => void load());
    });
    return () => {
      cancelled = true;
      socket.current?.disconnect();
    };
  }, [ready, locked, load, authEpoch]);
  useEffect(() => {
    if (!ready || locked) return;
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && socket.current && session) {
        socket.current.auth = { token: session.access_token };
        socket.current.disconnect().connect();
      }
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, [ready, locked]);
  useEffect(() => {
    if (recording.isRecording) {
      setWave((v) => [...v.slice(1), Math.max(4, ((recording.metering || -60) + 60) * 0.8)]);
      if (recording.durationMillis >= 180000) void recorder.stop().then(() => setAudioReady(true));
    }
  }, [recording.metering, recording.durationMillis, recording.isRecording, recorder]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('FinSight', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signIn() {
    if (!supabase) throw new Error('Configure Supabase to sign in.');
    const redirectTo = Linking.createURL('/auth/callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === 'success') {
      const code = new URL(result.url).searchParams.get('code');
      if (code) {
        const r = await supabase.auth.exchangeCodeForSession(code);
        if (r.error) throw r.error;
        await setupMfa();
      }
    }
  }
  async function setupMfa() {
    if (!supabase) return;
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    const f = data.totp.find((f) => f.status === 'verified');
    if (f) {
      setFactor(f.id);
      return;
    }
    const r = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'FinSight Mobile',
    });
    if (r.error) throw r.error;
    setFactor(r.data.id);
    setSecret(r.data.totp.secret);
  }
  async function connectBank() {
    const t = await api('/api/plaid/link-token', { method: 'POST' });
    const session = await createPlaidLinkSession({
      token: t.link_token,
      onEvent: () => {},
      onSuccess: async (success) => {
        try {
          await api('/api/plaid/exchange', {
            method: 'POST',
            body: JSON.stringify({ publicToken: success.publicToken }),
          });
          Alert.alert('Connected', 'Your 90-day history is importing in the background.');
          await load();
        } catch (e) {
          Alert.alert('Connection error', (e as Error).message);
        }
      },
      onExit: (exit) => {
        if (exit.error) Alert.alert('Plaid', exit.error.errorMessage);
      },
    });
    await session.open();
  }
  async function startRecording() {
    if (!(await AudioModule.requestRecordingPermissionsAsync()).granted)
      throw new Error('Microphone permission is required.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }
  async function saveReflection() {
    const body = new FormData();
    if (recorder.uri && live && audioReady) {
      body.append('audio', {
        uri: recorder.uri,
        name: 'reflection.m4a',
        type: 'audio/mp4',
      } as unknown as Blob);
    } else body.append('text', reflection);
    await api('/api/diary', { method: 'POST', body });
    setReflection('');
    setRecord(false);
    await load();
  }
  async function reminders() {
    if (!data) return;
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) throw new Error('Enable notifications in your device settings.');
    if (live) {
      const projectId = Constants.easConfig?.projectId || process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
      if (!projectId) throw new Error('Configure an EAS project and push credentials first.');
      const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
      await api('/api/push/mobile', { method: 'POST', body: JSON.stringify({ token: pushToken }) });
      await api('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify({ leadHours: leads, notifications: true }),
      });
      Alert.alert(
        'Reminders enabled',
        'Your server will send reminders from the latest bank data.',
      );
      return;
    }
    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const b of data.summary.bills.filter((b) => b.status !== 'paid'))
      for (const hours of leads) {
        const date = new Date(new Date(b.due + 'T12:00:00Z').getTime() - hours * 36e5);
        if (date > new Date())
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'FinSight · A gentle reminder',
              body: `A bill is due ${b.due}. Open FinSight to review.`,
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
          });
      }
    Alert.alert(
      'Reminders scheduled',
      'Local reminders have been refreshed from your current bill timeline.',
    );
  }
  const Button = ({
    title,
    onPress,
    secondary = false,
  }: {
    title: string;
    onPress: () => void;
    secondary?: boolean;
  }) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={[styles.button, { backgroundColor: secondary ? '#e8eedf' : '#36513a' }]}
    >
      <Text style={{ color: secondary ? '#60734f' : '#f4f9ee', fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
  if (!ready || locked)
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={styles.lock}>
          <Text style={styles.brand}>finsight.</Text>
          <Text style={[styles.title, { color: colors.text }]}>A space just for you.</Text>
          <Text style={styles.subtitle}>
            {error || 'Unlock your financial diary with Face ID or your fingerprint.'}
          </Text>
          {ready && (
            <Button
              title="Unlock FinSight"
              onPress={() => void run(async () => setLocked(!(await unlock())))}
            />
          )}
        </View>
      </SafeAreaView>
    );
  if (!live && !data)
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={styles.content}>
          <Text style={[styles.brand, { color: colors.text }]}>finsight.</Text>
          <Text style={[styles.title, { color: colors.text }]}>
            {localSetup ? 'Create your local account' : 'Welcome back'}
          </Text>
          <Text style={styles.subtitle}>
            Use the same account as the local web dashboard. Simulator testing only; the API stays
            on loopback.
          </Text>
          <TextInput
            accessibilityLabel="Email"
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={localEmail}
            onChangeText={setLocalEmail}
            placeholder="Email address"
          />
          <TextInput
            accessibilityLabel="Password"
            style={styles.input}
            secureTextEntry
            value={localPassword}
            onChangeText={setLocalPassword}
            placeholder="Password (at least 12 characters)"
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button
            title={localSetup ? 'Create local account' : 'Sign in'}
            onPress={() =>
              void run(async () => {
                await api(localSetup ? '/auth/register' : '/auth/login', {
                  method: 'POST',
                  body: JSON.stringify({ email: localEmail, password: localPassword }),
                });
                setLocalPassword('');
                setAuthEpoch((n) => n + 1);
                await load();
              })
            }
          />
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.brand, { color: colors.text }]}>finsight.</Text>
        <Pressable onPress={() => setTab('Settings')}>
          <Text style={styles.avatar}>JD</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.muted }]}>
          {live ? 'YOUR PERSONAL SPACE' : 'SAMPLE DATA · DEMO'}
        </Text>
        <Text style={[styles.title, { color: colors.text }]}>
          {tab === 'Home'
            ? 'A little more clarity.'
            : tab === 'Diary'
              ? 'Your money, your words.'
              : tab}
        </Text>
        {error && (
          <View style={styles.error}>
            <Text>{error}</Text>
            <Button title="Sign in with Google" onPress={() => void run(signIn)} />
            <Button
              title="Verify two-factor authentication"
              onPress={() => void run(setupMfa)}
              secondary
            />
          </View>
        )}
        {factor && (
          <View style={[styles.card, { backgroundColor: colors.panel }]}>
            {secret && (
              <Text selectable style={{ color: colors.text }}>
                Add this secret to your authenticator: {secret}
              </Text>
            )}
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              placeholder="6-digit authenticator code"
              value={code}
              onChangeText={setCode}
            />
            <Button
              title="Verify"
              onPress={() =>
                void run(async () => {
                  const r = await supabase!.auth.mfa.challengeAndVerify({ factorId: factor, code });
                  if (r.error) throw r.error;
                  setFactor('');
                  setSecret('');
                  await load();
                })
              }
            />
          </View>
        )}
        {data && tab === 'Home' && (
          <>
            <View style={styles.profit}>
              <Text style={styles.eyebrow}>AVAILABLE BALANCE</Text>
              <Text style={styles.balance}>
                {money(data.summary.profit, data.summary.currency)}
              </Text>
              <Text style={styles.subtitle}>Income − expenses − outstanding debt</Text>
              <View style={styles.metricRow}>
                {[
                  ['Income', data.summary.income],
                  ['Expenses', data.summary.expenses],
                  ['Debt', data.summary.debt],
                ].map(([label, value]) => (
                  <View key={label}>
                    <Text style={styles.muted}>{label}</Text>
                    <Text style={styles.metric}>{money(Number(value), data.summary.currency)}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.card, { backgroundColor: colors.panel }]}>
              <Text style={[styles.section, { color: colors.text }]}>Where it’s going</Text>
              <View style={styles.donutRow}>
                <Svg width={120} height={120} viewBox="0 0 120 120">
                  <Circle cx={60} cy={60} r={44} fill="none" stroke="#edf1e5" strokeWidth={16} />
                  {(() => {
                    let offset = 0;
                    return data.summary.spending.map((c) => {
                      const length = (c.amount / Math.max(1, data.summary.expenses)) * 276.46,
                        previous = offset;
                      offset += length;
                      return (
                        <Circle
                          key={c.name}
                          cx={60}
                          cy={60}
                          r={44}
                          fill="none"
                          stroke={c.color}
                          strokeWidth={16}
                          strokeDasharray={`${length} ${276.46 - length}`}
                          strokeDashoffset={-previous}
                          rotation={-90}
                          origin="60,60"
                        />
                      );
                    });
                  })()}
                </Svg>
                <View style={{ flex: 1 }}>
                  {data.summary.spending.slice(0, 5).map((c) => (
                    <View key={c.name} style={styles.legend}>
                      <View
                        style={{ width: 7, height: 7, borderRadius: 3, backgroundColor: c.color }}
                      />
                      <Text style={[styles.muted, { flex: 1 }]}>{c.name}</Text>
                      <Text style={{ color: colors.text, fontSize: 11 }}>
                        {money(c.amount, data.summary.currency)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
            <View style={[styles.card, { backgroundColor: colors.panel }]}>
              <Text style={[styles.section, { color: colors.text }]}>
                The latest little details
              </Text>
              {data.transactions
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 5)
                .map((t) => (
                  <View key={t.id} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 12 }}>{t.name}</Text>
                      <Text style={styles.muted}>
                        {t.category} · {t.date}
                      </Text>
                    </View>
                    <Text style={{ color: t.amount < 0 ? '#8fa86b' : colors.text, fontSize: 12 }}>
                      {t.amount < 0 ? '+' : '−'}
                      {money(Math.abs(t.amount), t.currency)}
                    </Text>
                  </View>
                ))}
            </View>
            <Button
              title="Connect a bank account"
              secondary
              onPress={() => void run(connectBank)}
            />
          </>
        )}
        {data && tab === 'Bills' && (
          <>
            {data.summary.bills.map((b) => (
              <View key={b.id} style={[styles.card, { backgroundColor: colors.panel }]}>
                <View style={styles.legend}>
                  <Text style={[styles.section, { flex: 1, color: colors.text }]}>{b.name}</Text>
                  <Text style={{ color: colors.text }}>
                    {money(b.amount, data.summary.currency)}
                  </Text>
                </View>
                <Text style={styles.muted}>
                  {b.due} · {b.status}
                </Text>
              </View>
            ))}
            <Button title="Refresh device reminders" onPress={() => void run(reminders)} />
          </>
        )}
        {data &&
          tab === 'Budgets' &&
          data.budgets.map((b) => {
            const spent = data.summary.spending.find((c) => c.name === b.category)?.amount || 0;
            return (
              <View key={b.category} style={[styles.card, { backgroundColor: colors.panel }]}>
                <Text style={[styles.section, { color: colors.text }]}>{b.category}</Text>
                <Text style={styles.subtitle}>
                  {money(spent, data.summary.currency)} of {money(b.limit, data.summary.currency)}
                </Text>
                <View style={styles.track}>
                  <View
                    style={{
                      height: 6,
                      borderRadius: 4,
                      width: `${Math.min(100, (spent / Math.max(1, b.limit)) * 100)}%`,
                      backgroundColor: '#a3b785',
                    }}
                  />
                </View>
              </View>
            );
          })}
        {data && tab === 'Diary' && (
          <>
            <Text style={styles.subtitle}>
              Notice a pattern. Celebrate a win. Let a thought go.
            </Text>
            <Button
              title="＋ Capture a thought"
              onPress={() => {
                setAudioReady(false);
                setRecord(true);
              }}
            />
            {data.diaries.map((d) => (
              <View key={d.id} style={[styles.card, { backgroundColor: colors.panel }]}>
                <Text style={styles.eyebrow}>{new Date(d.createdAt).toLocaleDateString()}</Text>
                <Text style={[styles.reflection, { color: colors.text }]}>{d.transcript}</Text>
                <Text style={styles.muted}>{d.tags.join(' · ')}</Text>
              </View>
            ))}
          </>
        )}
        {tab === 'Ask' && (
          <>
            <View style={[styles.card, { backgroundColor: colors.panel }]}>
              <Text style={[styles.section, { color: colors.text }]}>Your financial copilot</Text>
              <Text style={styles.subtitle}>Ask a question. We’ll work through the numbers.</Text>
              <TextInput
                style={styles.input}
                value={message}
                onChangeText={setMessage}
                placeholder="Can I afford a $2,000 laptop?"
                multiline
              />
              <Button
                title="Ask FinSight ↗"
                onPress={() =>
                  void run(async () => {
                    setReply(
                      (
                        await api('/api/chat', {
                          method: 'POST',
                          body: JSON.stringify({ message }),
                        })
                      ).text,
                    );
                  })
                }
              />
            </View>
            {reply && (
              <View style={[styles.card, { backgroundColor: colors.panel }]}>
                <Text style={[styles.reflection, { color: colors.text }]}>{reply}</Text>
              </View>
            )}
          </>
        )}
        {tab === 'Settings' && (
          <View style={[styles.card, { backgroundColor: colors.panel }]}>
            <Text style={[styles.section, { color: colors.text }]}>Bill reminders</Text>
            <Text style={styles.subtitle}>
              Choose when you’d like a gentle nudge before bills are due.
            </Text>
            {[72, 24, 1].map((h) => (
              <Pressable
                key={h}
                style={styles.row}
                onPress={() =>
                  setLeads((s) => (s.includes(h) ? s.filter((x) => x !== h) : [...s, h]))
                }
              >
                <Text style={{ color: colors.text }}>
                  {leads.includes(h) ? '☑' : '☐'} {h === 72 ? '3 days' : h + ' hours'} before
                </Text>
              </Pressable>
            ))}
            <Button title="Save device reminders" onPress={() => void run(reminders)} />
            <Button title="Connect account" secondary onPress={() => void run(connectBank)} />
            <Button
              title="Sign out"
              secondary
              onPress={() =>
                void run(async () => {
                  await api('/api/session/logout', { method: 'POST' });
                  await supabase?.auth.signOut({ scope: 'local' });
                  socket.current?.disconnect();
                  setData(null);
                  setReply('');
                  setTab('Home');
                })
              }
            />
            {live && (
              <Button
                title="Lock diary"
                secondary
                onPress={() => {
                  setData(null);
                  setLocked(true);
                }}
              />
            )}
          </View>
        )}
        {busy && <ActivityIndicator style={{ margin: 20 }} color="#8aa16b" />}
        <Text style={styles.footer}>A little clarity goes a long way.</Text>
      </ScrollView>
      <View style={[styles.tabs, { backgroundColor: colors.panel }]}>
        {['Home', 'Bills', 'Budgets', 'Diary', 'Ask'].map((n) => (
          <Pressable key={n} style={styles.tab} onPress={() => setTab(n)}>
            <Text
              style={{
                fontSize: 11,
                color: tab === n ? '#769450' : colors.muted,
                fontWeight: tab === n ? '700' : '400',
              }}
            >
              {n}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={record}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setRecord(false)}
      >
        <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable
              onPress={() => {
                if (recording.isRecording) void recorder.stop();
                setRecord(false);
              }}
            >
              <Text style={styles.muted}>Close ✕</Text>
            </Pressable>
            <Text style={[styles.title, { color: colors.text, marginTop: 25 }]}>
              A moment to reflect.
            </Text>
            <Text style={styles.subtitle}>What’s on your mind about money today?</Text>
            <View style={styles.wave}>
              {wave.map((h, i) => (
                <View
                  key={i}
                  style={{ width: 5, height: h, borderRadius: 3, backgroundColor: '#97af76' }}
                />
              ))}
            </View>
            <Text style={[styles.subtitle, { textAlign: 'center' }]}>
              {Math.floor(recording.durationMillis / 1000)} seconds
            </Text>
            <Button
              title={recording.isRecording ? '■ Stop recording' : '● Start recording'}
              onPress={() =>
                void run(async () => {
                  if (recording.isRecording) {
                    await recorder.stop();
                    setAudioReady(true);
                  } else {
                    setAudioReady(false);
                    await startRecording();
                  }
                })
              }
            />
            <TextInput
              placeholder="Or write a reflection…"
              multiline
              style={[styles.input, { height: 130, textAlignVertical: 'top' }]}
              value={reflection}
              onChangeText={setReflection}
            />
            {!live && (
              <Text style={styles.muted}>
                Demo saves written reflections. Audio transcription needs live services.
              </Text>
            )}
            <Button
              title={busy ? 'Saving…' : 'Save reflection'}
              onPress={() => {
                if (!recording.isRecording) void run(saveReflection);
              }}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { fontSize: 30, fontWeight: '800', letterSpacing: -1.5, color: '#304434' },
  avatar: {
    padding: 10,
    borderRadius: 30,
    backgroundColor: '#e7dfcc',
    color: '#8d7e61',
    fontSize: 11,
  },
  content: { padding: 23, paddingBottom: 35 },
  eyebrow: { fontSize: 9, letterSpacing: 1.8, color: '#8c9c77', marginBottom: 10 },
  title: { fontSize: 30, fontWeight: '600', letterSpacing: -1.1, marginBottom: 12 },
  subtitle: { fontSize: 12, color: '#8a987e', lineHeight: 21, marginVertical: 7 },
  profit: {
    padding: 25,
    borderRadius: 17,
    backgroundColor: '#e6eddb',
    marginTop: 20,
    marginBottom: 8,
  },
  balance: { fontSize: 40, letterSpacing: -1.6, color: '#3c5136', fontWeight: '600' },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: '#d7e0cb',
    paddingTop: 20,
    marginTop: 18,
  },
  metric: { fontSize: 14, color: '#566b44', fontWeight: '600', marginTop: 5 },
  muted: { color: '#93a083', fontSize: 10, lineHeight: 18 },
  card: { padding: 22, borderRadius: 14, marginTop: 16, borderWidth: 1, borderColor: '#c7d2bb30' },
  section: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 7, marginVertical: 5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 10,
    borderBottomWidth: 1,
    borderColor: '#b5c3a525',
  },
  button: { padding: 16, alignItems: 'center', borderRadius: 9, marginTop: 15 },
  input: {
    backgroundColor: '#f0f4e9',
    padding: 15,
    borderRadius: 10,
    marginVertical: 15,
    fontSize: 13,
    color: '#405636',
  },
  reflection: { fontSize: 15, lineHeight: 25, marginVertical: 10 },
  track: { backgroundColor: '#e8eddf', height: 6, borderRadius: 4, marginVertical: 13 },
  tabs: {
    flexDirection: 'row',
    padding: 9,
    paddingBottom: 15,
    borderTopWidth: 1,
    borderColor: '#b8c7a325',
  },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 130,
  },
  footer: { color: '#a2ae96', fontSize: 10, textAlign: 'center', marginTop: 35 },
  lock: { flex: 1, justifyContent: 'center', padding: 35, gap: 15 },
  error: { backgroundColor: '#efe5d7', padding: 15, borderRadius: 10, marginVertical: 20 },
});
