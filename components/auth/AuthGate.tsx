import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/store/useAuthStore';
import { useSimStore } from '@/store/useSimStore';
import { last9Digits, verifyNotificationNumber } from '@/services/numberVerification';
import { registerAgentOnBackend, loginAgentOnBackend } from '@/services/agentBackend';
import { refreshSimSlots, requestSmsPermissions } from '@/services/smsAutomation';

/**
 * Best-effort sync with the central backend. Called after a
 * SIM-verified local login/setup succeeds. Failure here (offline, or
 * server down) is silent and non-blocking — the agent still gets in
 * using local credentials, exactly like before this backend existed.
 * It just means this device won't have central subscription tracking
 * until the next time it's online during a login.
 */
async function syncWithBackend(number: string, password: string, isFirstSetup: boolean) {
  const setAgentIdentity = useAuthStore.getState().setAgentIdentity;
  const existingAgentId = useAuthStore.getState().agentId;

  const result = isFirstSetup
    ? await registerAgentOnBackend(number, password)
    : await loginAgentOnBackend(number, password);

  if (result.ok) {
    setAgentIdentity(result.agentId, result.agentKey);
    return;
  }

  // Registering again on a device that already has a local account but
  // never reached the server before (e.g. first setup was offline) —
  // fall back to login once we do have connectivity.
  if (isFirstSetup && !existingAgentId) {
    const loginResult = await loginAgentOnBackend(number, password);
    if (loginResult.ok) setAgentIdentity(loginResult.agentId, loginResult.agentKey);
  }
}

/**
 * Gates the whole app behind an agent account. Renders in place of the
 * app's <Stack> — not a router route — so there's no navigation race
 * between "logged out" and the tabs mounting underneath.
 *
 *   not set up yet -> SetupScreen (create the account once)
 *   set up, not logged in this session -> LoginScreen (every cold start)
 *   logged in -> children (the real app)
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const isSetUp = useAuthStore((s) => s.isSetUp);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  if (!isSetUp) return <SetupScreen />;
  if (!isLoggedIn) return <LoginScreen />;
  return <>{children}</>;
}

/**
 * Runs the full login check: password must match the stored account,
 * the typed Notification Number must match the stored account, AND a
 * live USSD dial must confirm this SIM's actual number matches — any
 * one mismatch fails the login, even if the password alone was right.
 */
async function attemptLogin(
  typedNumber: string,
  typedPassword: string
): Promise<{ ok: true; verifiedNumber: string } | { ok: false; error: string }> {
  const { notificationNumber, password } = useAuthStore.getState();

  if (typedPassword !== password) {
    return { ok: false, error: 'Incorrect password.' };
  }
  if (!notificationNumber || last9Digits(typedNumber) !== last9Digits(notificationNumber)) {
    return { ok: false, error: 'This Notification Number does not match your account.' };
  }

  const result = await verifyNotificationNumber(typedNumber);
  if (result.error) {
    return { ok: false, error: result.error };
  }
  if (!result.matched) {
    return {
      ok: false,
      error: `The SIM in this phone (${result.detectedNumber}) does not match the Notification Number entered.`,
    };
  }

  return { ok: true, verifiedNumber: result.detectedNumber! };
}

function SetupScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const completeSetup = useAuthStore((s) => s.completeSetup);
  const setLoggedIn = useAuthStore((s) => s.setLoggedIn);

  const [number, setNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const onSave = async () => {
    setError(null);
    if (!number.trim() || last9Digits(number).length !== 9) {
      setError('Enter a valid Notification Number.');
      return;
    }
    if (!password) {
      setError('Choose a password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    completeSetup(number, password);

    // Verify immediately so the agent finds out right away if the SIM
    // doesn't match, rather than discovering it on next app open.
    setVerifying(true);
    const result = await attemptLogin(number, password);
    setVerifying(false);

    if (!result.ok) {
      setError(
        `${result.error} You can fix this from Settings → USSD Settings → Login / Number Verification, then reopen the app to log in.`
      );
      return;
    }
    setLoggedIn(true, result.verifiedNumber);
    syncWithBackend(number, password, true);
  };

  return (
    <AuthScaffold colors={c} insets={insets} title="Set up your account">
      <Text style={{ color: c.textSecondary, fontSize: 13 }}>
        This is a one-time setup for this device. Your Notification Number should be the number
        on the SIM customers pay and text — the same one used for Auto Reply.
      </Text>

      <Field
        label="Notification Number"
        colors={c}
        value={number}
        onChangeText={setNumber}
        placeholder="07XXXXXXXX"
        keyboardType="phone-pad"
      />
      <Field
        label="Password"
        colors={c}
        value={password}
        onChangeText={setPassword}
        placeholder="Choose a password"
        secureTextEntry
      />
      <Field
        label="Confirm password"
        colors={c}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Re-enter password"
        secureTextEntry
      />

      <InlineSimPicker colors={c} />

      {error && <Text style={{ color: c.error, fontSize: 13 }}>{error}</Text>}

      <Pressable
        disabled={verifying}
        onPress={onSave}
        style={[styles.primaryBtn, { backgroundColor: c.tint, opacity: verifying ? 0.7 : 1 }]}>
        {verifying ? (
          <ActivityIndicator color={c.onTint} />
        ) : (
          <Text style={[styles.primaryBtnText, { color: c.onTint }]}>Save & continue</Text>
        )}
      </Pressable>

      {verifying && (
        <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>
          Verifying number via USSD…
        </Text>
      )}
    </AuthScaffold>
  );
}

function LoginScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const storedNumber = useAuthStore((s) => s.notificationNumber);
  const setLoggedIn = useAuthStore((s) => s.setLoggedIn);

  const [number, setNumber] = useState(storedNumber ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const onLogin = async () => {
    setError(null);
    if (!number.trim() || !password) {
      setError('Enter your Notification Number and password.');
      return;
    }

    setVerifying(true);
    const result = await attemptLogin(number, password);
    setVerifying(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLoggedIn(true, result.verifiedNumber);
    syncWithBackend(number, password, false);
  };

  return (
    <AuthScaffold colors={c} insets={insets} title="Log in">
      <Field
        label="Notification Number"
        colors={c}
        value={number}
        onChangeText={setNumber}
        placeholder="07XXXXXXXX"
        keyboardType="phone-pad"
      />
      <Field
        label="Password"
        colors={c}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
      />

      <InlineSimPicker colors={c} />

      {error && <Text style={{ color: c.error, fontSize: 13 }}>{error}</Text>}

      <Pressable
        disabled={verifying}
        onPress={onLogin}
        style={[styles.primaryBtn, { backgroundColor: c.tint, opacity: verifying ? 0.7 : 1 }]}>
        {verifying ? (
          <ActivityIndicator color={c.onTint} />
        ) : (
          <Text style={[styles.primaryBtnText, { color: c.onTint }]}>Log in</Text>
        )}
      </Pressable>

      {verifying && (
        <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>
          Confirming the SIM number via USSD…
        </Text>
      )}
    </AuthScaffold>
  );
}

/**
 * The "Notification SIM" picker, made reachable from the login/setup
 * screens themselves. This is the same tillSubscriptionId consumed by
 * numberVerification.ts — without it being set here, pre-login, there
 * was no way to reach it (the real picker in Settings only mounts
 * after login, which requires this to already be set — a lockout).
 */
function InlineSimPicker({ colors }: { colors: (typeof Colors)['light'] }) {
  const availableSims = useSimStore((s) => s.availableSims);
  const tillSubscriptionId = useSimStore((s) => s.tillSubscriptionId);
  const setTillSim = useSimStore((s) => s.setTillSim);
  const [loading, setLoading] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const load = async () => {
    setLoading(true);
    setPermissionDenied(false);
    const ok = await requestSmsPermissions();
    if (!ok) {
      setPermissionDenied(true);
      setLoading(false);
      return;
    }
    refreshSimSlots();
    setLoading(false);
  };

  useEffect(() => {
    if (availableSims.length === 0) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>Notification SIM</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Pick which SIM slot this phone should use to verify your number and dial USSD.
      </Text>

      {permissionDenied && (
        <Text style={{ color: colors.error, fontSize: 12 }}>
          Phone permission denied — allow it to detect SIMs, then tap Refresh.
        </Text>
      )}

      {availableSims.map((sim) => {
        const selected = tillSubscriptionId === sim.subscriptionId;
        return (
          <Pressable
            key={sim.subscriptionId}
            onPress={() => setTillSim(sim.subscriptionId)}
            style={[
              styles.simRow,
              {
                borderColor: selected ? colors.tint : colors.border,
                backgroundColor: selected ? colors.surfaceAlt : colors.background,
              },
            ]}>
            <Text style={{ color: colors.text, fontWeight: selected ? '700' : '500' }}>
              {sim.carrierName || sim.displayName || `SIM ${sim.slotIndex + 1}`}
              {sim.number ? ` — ${sim.number}` : ''}
            </Text>
            {selected && <Text style={{ color: colors.tint, fontWeight: '700' }}>Selected</Text>}
          </Pressable>
        );
      })}

      {availableSims.length === 0 && !loading && (
        <Text style={{ color: colors.muted, fontSize: 12 }}>No SIMs detected yet.</Text>
      )}

      <Pressable onPress={load} disabled={loading} style={{ alignSelf: 'flex-start' }}>
        <Text style={{ color: colors.tint, fontWeight: '600', fontSize: 13 }}>
          {loading ? 'Refreshing…' : 'Refresh SIM list'}
        </Text>
      </Pressable>
    </View>
  );
}

function AuthScaffold({
  colors,
  insets,
  title,
  children,
}: {
  colors: (typeof Colors)['light'];
  insets: { top: number; bottom: number };
  title: string;
  children: React.ReactNode;
}) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 20,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
        }}
        keyboardShouldPersistTaps="handled">
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  colors,
  ...inputProps
}: {
  label: string;
  colors: (typeof Colors)['light'];
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  title: { fontSize: 20, fontWeight: '800' },
  label: { fontSize: 12, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  primaryBtn: { borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  primaryBtnText: { fontWeight: '700', fontSize: 15 },
  simRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
});