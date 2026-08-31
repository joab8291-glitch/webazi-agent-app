import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { initiateStkPush, pollOrderStatus } from '@/services/darajaClient';
import { buildAccountRef } from '@/services/accountRef';

/**
 * Customer Payment form — despite the name, the "customer" here is a
 * Bingwa Sokoni agent buying airtime credit for their own automation
 * business, not a retail data-bundle buyer. Mirrors the flow already
 * live on the Webazi Airtime Hub website, just from inside this app:
 *
 *   1. Agent enters their paying number, the airtime amount they want
 *      delivered, and the receiving number that airtime goes to.
 *   2. Agent pays a 5% DISCOUNTED amount via STK push — amount=1000
 *      means the agent is charged ceil(1000 * 0.95) = 950, but 1000 in
 *      airtime is what gets delivered.
 *   3. The AccountReference sent to Daraja is NOT the plain receiving
 *      number — it's the same compact 10-char code the website builds
 *      (services/accountRef.ts: buildAccountRef), encoding network +
 *      the FULL 1000 (not the discounted 950) + the receiving number.
 *   4. Delivery is NOT triggered from this screen. Once the resulting
 *      M-Pesa confirmation SMS lands on the Till/Paybill SIM this app
 *      monitors, the existing SMS pipeline (services/accountRef.ts's
 *      decodeAccountRef + smsAutomation.ts) decodes that same ref and
 *      auto-dials Sambaza for the full amount on its own — this screen
 *      only needs to get the STK push sent and confirmed. Calling
 *      manualDeliver() here directly would double-deliver.
 *
 * Safaricom-only, matching both the reference website and this app's
 * existing Airtel removal elsewhere.
 */

const DISCOUNT_RATE = 0.05;

export default function CustomerPaymentScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [payingNumber, setPayingNumber] = useState('');
  const [amountDraft, setAmountDraft] = useState('');
  const [receivingNumber, setReceivingNumber] = useState('');

  const [stage, setStage] = useState<'idle' | 'sending' | 'awaiting_pin' | 'confirmed' | 'failed'>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const busy = stage === 'sending' || stage === 'awaiting_pin';

  const amount = Number(amountDraft.replace(/[^0-9.]/g, ''));
  const validAmount = Number.isFinite(amount) && amount > 0;
  const payAmount = validAmount ? Math.ceil(amount * (1 - DISCOUNT_RATE)) : null;

  const handleSubmit = async () => {
    const phone = payingNumber.trim();
    const receiveNum = receivingNumber.trim();

    if (!phone) {
      Alert.alert('Paying number required', "Enter the agent's M-Pesa number.");
      return;
    }
    if (!validAmount || payAmount == null) {
      Alert.alert('Invalid amount', 'Enter a valid airtime amount.');
      return;
    }
    if (!receiveNum) {
      Alert.alert('Receiving number required', 'Enter the number airtime should be sent to.');
      return;
    }

    const ref = buildAccountRef('safaricom', amount, receiveNum);

    setStage('sending');
    setStatusMessage(null);

    const pushResult = await initiateStkPush({
      phone,
      amount: payAmount,
      accountRef: ref,
      description: `Airtime Safaricom KES ${amount}`,
    });

    if (!pushResult.ok) {
      setStage('failed');
      setStatusMessage(pushResult.reason);
      return;
    }

    setStage('awaiting_pin');
    setStatusMessage('STK push sent — ask the agent to enter their M-Pesa PIN.');

    const outcome = await pollOrderStatus(pushResult.merchantRequestId);

    if (outcome.ok) {
      setStage('confirmed');
      setStatusMessage(
        `Payment confirmed${outcome.order.receipt ? ` (receipt ${outcome.order.receipt})` : ''}. KES ${amount} airtime to ${receiveNum} will be delivered automatically once the M-Pesa SMS is processed.`
      );
    } else {
      setStage('failed');
      setStatusMessage(outcome.reason);
    }
  };

  const handleReset = () => {
    setStage('idle');
    setStatusMessage(null);
    setPayingNumber('');
    setAmountDraft('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: c.text, fontSize: 16 }}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Customer Payment</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 32 }}>
        <View>
          <Text style={[styles.label, { color: c.textSecondary }]}>Paying number</Text>
          <TextInput
            value={payingNumber}
            onChangeText={setPayingNumber}
            editable={!busy}
            placeholder="07XXXXXXXX"
            placeholderTextColor={c.muted}
            keyboardType="phone-pad"
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />
          <Text style={{ color: c.muted, fontSize: 11 }}>
            The agent's own M-Pesa number — they'll get the PIN prompt on this number.
          </Text>
        </View>

        <View>
          <Text style={[styles.label, { color: c.textSecondary }]}>Airtime amount (KES)</Text>
          <TextInput
            value={amountDraft}
            onChangeText={setAmountDraft}
            editable={!busy}
            placeholder="e.g. 1000"
            placeholderTextColor={c.muted}
            keyboardType="numeric"
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />
          {validAmount && payAmount != null && (
            <Text style={{ color: c.tint, fontSize: 12, fontWeight: '600' }}>
              Agent pays KES {payAmount} (5% discount) — receives KES {amount} airtime
            </Text>
          )}
        </View>

        <View>
          <Text style={[styles.label, { color: c.textSecondary }]}>Receiving number</Text>
          <TextInput
            value={receivingNumber}
            onChangeText={setReceivingNumber}
            editable={!busy}
            placeholder="07XXXXXXXX"
            placeholderTextColor={c.muted}
            keyboardType="phone-pad"
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />
          <Text style={{ color: c.muted, fontSize: 11 }}>
            Where the airtime gets delivered. Encoded (with amount + network) into a compact
            account reference — never sent as a plain number.
          </Text>
        </View>

        <Pressable
          onPress={handleSubmit}
          disabled={busy}
          style={[styles.submitButton, { backgroundColor: c.tint, opacity: busy ? 0.6 : 1 }]}>
          {busy ? (
            <ActivityIndicator color={c.onTint} />
          ) : (
            <Text style={{ color: c.onTint, fontWeight: '700' }}>Send Payment Request</Text>
          )}
        </Pressable>

        {statusMessage && (
          <Text
            style={{
              color: stage === 'confirmed' ? c.success : stage === 'failed' ? c.error : c.textSecondary,
              fontSize: 13,
            }}>
            {statusMessage}
          </Text>
        )}

        {(stage === 'confirmed' || stage === 'failed') && (
          <Pressable onPress={handleReset} style={[styles.submitButton, { backgroundColor: c.surfaceAlt }]}>
            <Text style={{ color: c.text, fontWeight: '600' }}>New payment</Text>
          </Pressable>
        )}

        <Text style={{ color: c.muted, fontSize: 11 }}>
          Requires the Daraja backend URL and API key set in Settings, plus a Safaricom execution
          SIM and this app's Till/Paybill SIM already configured to receive the resulting M-Pesa
          confirmation SMS.
        </Text>
      </ScrollView>
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
  label: { fontSize: 12, marginBottom: 6, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  submitButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
