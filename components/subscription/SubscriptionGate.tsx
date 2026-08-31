import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/store/useAuthStore';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';
import {
  paySubscription,
  paySubscriptionViaStk,
  SubscriptionMonths,
  SUBSCRIPTION_PRICE,
} from '@/services/subscription';
import { reportPayment, BUILD_VARIANT } from '@/services/agentBackend';

type PaymentMethod = 'stk' | 'sambaza';

/**
 * Gates the whole app behind an active subscription, once logged in.
 * Renders in place of children (same approach as AuthGate) — sits just
 * inside AuthGate in app/_layout.tsx, so login always happens first.
 *
 *   trial (first 7 days after first login) -> children, with a banner
 *   active subscription                    -> children
 *   expired                                -> full-screen payment screen
 */
export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  // Free-access build: never gate, never show a trial/payment screen,
  // regardless of what the server would say. The backend still marks
  // agents registered from this build as buildVariant/isFreeAccess so
  // they show up correctly (as "Free") in the admin dashboard — this
  // is purely a client-side skip so a free agent never even needs
  // connectivity to use the app.
  if (BUILD_VARIANT === 'free') {
    return <>{children}</>;
  }

  // Re-check on a timer so a trial/subscription that lapses — or a
  // remote revoke by the admin — while the app is sitting open still
  // gets caught without needing an app restart.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const tick = () => forceTick((n) => n + 1);
    const id = setInterval(tick, 60_000);

    // Pull fresh status from the server right away, then every 30 min
    // while the app is open. This is what lets an admin revoke/extend/
    // grant-free take effect on the agent's phone without them having
    // to log out and back in.
    const syncNow = () => useSubscriptionStore.getState().syncWithServer().then(tick);
    syncNow();
    const syncId = setInterval(syncNow, 30 * 60_000);

    return () => {
      clearInterval(id);
      clearInterval(syncId);
    };
  }, []);

  // Subscribing to these values (even unused directly) means we also
  // re-render immediately the moment a payment is registered, a server
  // sync lands, or firstLoginAt is first set, rather than waiting for
  // the next tick.
  useSubscriptionStore((s) => s.subscriptionEndDate);
  useSubscriptionStore((s) => s.lastServerSyncAt);
  useAuthStore((s) => s.firstLoginAt);

  const { status, trialEndsAt } = useSubscriptionStore.getState().getStatus();

  if (status === 'expired' || status === 'revoked') {
    return <SubscriptionPaymentScreen mode="blocking" revoked={status === 'revoked'} />;
  }

  return (
    <>
      {status === 'trial' && trialEndsAt && <TrialBanner trialEndsAt={trialEndsAt} />}
      {children}
    </>
  );
}

function TrialBanner({ trialEndsAt }: { trialEndsAt: Date }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const daysLeft = Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  return (
    <View style={[bannerStyles.wrap, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
      <Text style={{ color: c.textSecondary, fontSize: 12 }}>
        Trial: {daysLeft} day{daysLeft === 1 ? '' : 's'} left. Pay subscription anytime from Settings to
        avoid interruption.
      </Text>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});

/**
 * Reusable subscription status + payment content.
 *
 * mode="blocking"  — used by the gate itself when access has expired;
 *                     no way to dismiss without paying.
 * mode="voluntary" — used by app/subscription.tsx (linked from
 *                     Settings) so an agent can check their status or
 *                     renew early, with a back button.
 */
export function SubscriptionPaymentScreen({
  mode,
  onBack,
  revoked,
}: {
  mode: 'blocking' | 'voluntary';
  onBack?: () => void;
  /** Access was blocked by an admin (server status = 'revoked'), not
   * just an ordinary trial/subscription lapse. Payment still re-opens
   * access once confirmed — revoke isn't permanent, it's the admin's
   * pause button — but the messaging is different so the agent isn't
   * confused about why a previously-active subscription stopped. */
  revoked?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const [, forceTick] = useState(0);
  const registerPayment = useSubscriptionStore((s) => s.registerPayment);
  const { status, trialEndsAt, subscriptionEndsAt } = useSubscriptionStore.getState().getStatus();

  const [method, setMethod] = useState<PaymentMethod>('stk');
  const [payingNumber, setPayingNumber] = useState('');
  const [payingMonths, setPayingMonths] = useState<SubscriptionMonths | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessMonths, setLastSuccessMonths] = useState<SubscriptionMonths | null>(null);

  const handlePay = async (months: SubscriptionMonths) => {
    setError(null);
    setLastSuccessMonths(null);

    if (method === 'stk' && !payingNumber.trim()) {
      setError("Enter the agent's M-Pesa number to send the STK push to.");
      return;
    }

    setPayingMonths(months);
    const result =
      method === 'stk' ? await paySubscriptionViaStk(months, payingNumber.trim()) : await paySubscription(months);
    setPayingMonths(null);

    if (result.ok) {
      registerPayment(months);
      setLastSuccessMonths(months);
      forceTick((n) => n + 1);

      // Report to the central DB so the admin dashboard reflects this
      // payment. Best-effort: if this device just paid, it clearly had
      // connectivity a moment ago (STK needs it; Sambaza doesn't, so
      // this call specifically CAN fail offline) — a subsequent
      // syncWithServer() will reconcile once back online regardless.
      const { agentId, agentKey } = useAuthStore.getState();
      if (agentId && agentKey) {
        reportPayment(agentId, agentKey, months, method).then(() => {
          useSubscriptionStore.getState().syncWithServer();
        });
      }
    } else {
      setError(result.reason);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        {mode === 'voluntary' ? (
          <Pressable onPress={onBack} hitSlop={8}>
            <Text style={{ color: c.text, fontSize: 16 }}>←</Text>
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
        <Text style={[styles.title, { color: c.text }]}>Subscription</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 32 }}>
        {mode === 'blocking' && (
          <Text style={{ color: c.error, fontSize: 14, fontWeight: '600' }}>
            {revoked
              ? 'Your access was paused by the admin. Pay your subscription to reactivate it.'
              : 'Your trial has ended. Pay your subscription to continue using the app.'}
          </Text>
        )}

        <StatusCard colors={c} status={status} trialEndsAt={trialEndsAt} subscriptionEndsAt={subscriptionEndsAt} />

        {lastSuccessMonths && (
          <Text style={{ color: c.success, fontSize: 13 }}>
            Subscription payment confirmed — access extended.
          </Text>
        )}
        {error && <Text style={{ color: c.error, fontSize: 13 }}>{error}</Text>}

        <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600' }}>Payment method</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <MethodTab
            label="M-Pesa STK"
            selected={method === 'stk'}
            onPress={() => setMethod('stk')}
            colors={c}
          />
          <MethodTab
            label="Sambaza to my number"
            selected={method === 'sambaza'}
            onPress={() => setMethod('sambaza')}
            colors={c}
          />
        </View>

        {method === 'stk' && (
          <View>
            <Text style={[{ fontSize: 12, marginBottom: 6, fontWeight: '600' }, { color: c.textSecondary }]}>
              Your M-Pesa number
            </Text>
            <TextInput
              value={payingNumber}
              onChangeText={setPayingNumber}
              editable={payingMonths === null}
              placeholder="07XXXXXXXX"
              placeholderTextColor={c.muted}
              keyboardType="phone-pad"
              style={[
                styles.input,
                { backgroundColor: c.surface, borderColor: c.border, color: c.text },
              ]}
            />
            <Text style={{ color: c.muted, fontSize: 11 }}>
              You'll get the M-Pesa PIN prompt on this number.
            </Text>
          </View>
        )}

        <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600' }}>Pay subscription</Text>
        <View style={{ gap: 10 }}>
          {([1, 2] as SubscriptionMonths[]).map((months) => (
            <Pressable
              key={months}
              disabled={payingMonths !== null}
              onPress={() => handlePay(months)}
              style={[
                styles.payBtn,
                { backgroundColor: c.tint, opacity: payingMonths !== null ? 0.7 : 1 },
              ]}>
              {payingMonths === months ? (
                <ActivityIndicator color={c.onTint} />
              ) : (
                <Text style={{ color: c.onTint, fontWeight: '700' }}>
                  {months} month{months === 2 ? 's' : ''} — KES {SUBSCRIPTION_PRICE[months]}
                </Text>
              )}
            </Pressable>
          ))}
        </View>

        <Text style={{ color: c.muted, fontSize: 11 }}>
          {method === 'stk'
            ? 'An M-Pesa STK push is sent to the number above via the same Daraja backend used for Customer Payment. Access extends the moment the payment is confirmed.'
            : 'Payment is sent automatically as airtime via Sambaza using your configured Safaricom execution SIM. Access extends the moment the dial is confirmed — no need to wait for an SMS.'}
        </Text>
      </ScrollView>
    </View>
  );
}

function MethodTab({
  label,
  selected,
  onPress,
  colors: c,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.methodTab,
        { backgroundColor: selected ? c.tint : c.surface, borderColor: selected ? c.tint : c.border },
      ]}>
      <Text style={{ color: selected ? c.onTint : c.textSecondary, fontWeight: '600', fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatusCard({
  colors: c,
  status,
  trialEndsAt,
  subscriptionEndsAt,
}: {
  colors: (typeof Colors)['light'];
  status: 'trial' | 'active' | 'expired';
  trialEndsAt: Date | null;
  subscriptionEndsAt: Date | null;
}) {
  let label = 'Expired';
  let detail = 'No active subscription.';

  if (status === 'trial' && trialEndsAt) {
    label = 'Trial';
    detail = `Free access until ${trialEndsAt.toLocaleString()}`;
  } else if (status === 'active' && subscriptionEndsAt) {
    label = 'Active';
    detail = `Access until ${subscriptionEndsAt.toLocaleString()}`;
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{label}</Text>
      <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 2 }}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 17, fontWeight: '700' },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  payBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  methodTab: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
});
