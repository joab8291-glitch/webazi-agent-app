import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppSettingsStore } from '@/store/useAppSettingsStore';
import { manualDeliver } from '@/services/smsAutomation';

/**
 * Sambaza self top-up — lets the agent top up airtime to their own
 * ("My Set number") default number without waiting for a customer
 * payment SMS. Reuses the same manualDeliver() pipeline as the
 * Unmatched-bucket manual recommendation flow, so it shows up on the
 * Transactions screen with the same tracking/retries.
 *
 * Amount presets (KES 300 / 600) mirror the Subscription pricing tiers
 * per the agent's spec — freeform amount is still allowed for anything
 * else.
 */

const AMOUNT_PRESETS = [300, 600];

export default function SambazaTopupScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const mySambazaNumber = useAppSettingsStore((s) => s.mySambazaNumber);
  const setMySambazaNumber = useAppSettingsStore((s) => s.setMySambazaNumber);

  const [numberDraft, setNumberDraft] = useState(mySambazaNumber);
  const [amountDraft, setAmountDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSaveNumber = () => setMySambazaNumber(numberDraft.trim());

  const handleTopUp = async () => {
    const phone = numberDraft.trim();
    const amount = Number(amountDraft.replace(/[^0-9.]/g, ''));

    if (!phone) {
      Alert.alert('My Set number required', 'Enter the number to Sambaza airtime to first.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid airtime amount.');
      return;
    }

    setMySambazaNumber(phone);
    setSubmitting(true);
    try {
      const result = await manualDeliver({ phone, amount, network: 'safaricom' });
      if (result.ok) {
        Alert.alert('Queued', `Sambaza of KES ${amount} to ${phone} has been queued.`);
        setAmountDraft('');
      } else {
        Alert.alert('Failed to queue', result.reason ?? 'Unknown error');
      }
    } catch (e: any) {
      Alert.alert('Error', String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: c.text, fontSize: 16 }}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Sambaza to Self</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 32 }}>
        <View>
          <Text style={[styles.label, { color: c.textSecondary }]}>My Set number</Text>
          <TextInput
            value={numberDraft}
            onChangeText={setNumberDraft}
            onBlur={handleSaveNumber}
            placeholder="07XXXXXXXX"
            placeholderTextColor={c.muted}
            keyboardType="phone-pad"
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />
          <Text style={{ color: c.muted, fontSize: 11 }}>
            Saved as your default Sambaza destination — dials on the Safaricom execution SIM
            configured in Settings.
          </Text>
        </View>

        <View>
          <Text style={[styles.label, { color: c.textSecondary }]}>Amount (KES)</Text>
          <TextInput
            value={amountDraft}
            onChangeText={setAmountDraft}
            placeholder="e.g. 300"
            placeholderTextColor={c.muted}
            keyboardType="numeric"
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {AMOUNT_PRESETS.map((preset) => (
              <Pressable
                key={preset}
                onPress={() => setAmountDraft(String(preset))}
                style={[
                  styles.presetChip,
                  {
                    borderColor: amountDraft === String(preset) ? c.tint : c.border,
                    backgroundColor: amountDraft === String(preset) ? c.tint : c.surface,
                  },
                ]}>
                <Text style={{ color: amountDraft === String(preset) ? c.onTint : c.text, fontWeight: '600' }}>
                  KES {preset}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          onPress={handleTopUp}
          disabled={submitting}
          style={[styles.submitButton, { backgroundColor: c.tint, opacity: submitting ? 0.6 : 1 }]}>
          <Text style={{ color: c.onTint, fontWeight: '700' }}>
            {submitting ? 'Queuing…' : 'Sambaza to Self'}
          </Text>
        </Pressable>

        <Text style={{ color: c.muted, fontSize: 11 }}>
          Amounts over KES 10,000 are automatically split into multiple Sambaza dials (Safaricom's
          per-transfer limit).
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
  presetChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  submitButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
