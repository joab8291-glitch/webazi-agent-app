import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSmsRelayStore, type RelayRule } from '@/store/useSmsRelayStore';
import { useSimStore } from '@/store/useSimStore';

/**
 * SMS Relay — forward incoming SMS matching a rule (sender substring,
 * optional amount range, optional specific SIM) to another number.
 * See services/smsRelay.ts for the matching + forwarding logic, hooked
 * into services/smsAutomation.ts's processSmsPayload() ahead of any
 * payment-processing gating.
 */
export default function SmsRelayScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const rules = useSmsRelayStore((s) => s.rules);
  const addRule = useSmsRelayStore((s) => s.addRule);
  const removeRule = useSmsRelayStore((s) => s.removeRule);
  const toggleRule = useSmsRelayStore((s) => s.toggleRule);
  const availableSims = useSimStore((s) => s.availableSims);

  const [showForm, setShowForm] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [senderDraft, setSenderDraft] = useState('MPESA');
  const [targetDraft, setTargetDraft] = useState('');
  const [minAmountDraft, setMinAmountDraft] = useState('');
  const [maxAmountDraft, setMaxAmountDraft] = useState('');
  const [simFilter, setSimFilter] = useState<number | 'any'>('any');

  const totalEvents = rules.reduce((sum, r) => sum + r.matchCount, 0);

  const resetForm = () => {
    setNameDraft('');
    setSenderDraft('MPESA');
    setTargetDraft('');
    setMinAmountDraft('');
    setMaxAmountDraft('');
    setSimFilter('any');
    setShowForm(false);
  };

  const handleAdd = () => {
    const target = targetDraft.trim();
    if (!target) {
      Alert.alert('Target number required', 'Enter the number to forward matching SMS to.');
      return;
    }

    addRule({
      name: nameDraft.trim() || `Relay to ${target}`,
      senderPattern: senderDraft.trim(),
      sourceSubscriptionId: simFilter,
      minAmount: minAmountDraft ? Number(minAmountDraft) : null,
      maxAmount: maxAmountDraft ? Number(maxAmountDraft) : null,
      targetNumber: target,
    });

    resetForm();
  };

  const handleRemove = (rule: RelayRule) => {
    Alert.alert('Remove rule?', rule.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeRule(rule.id) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: c.text, fontSize: 16 }}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>SMS Relay</Text>
        <Pressable onPress={() => setShowForm((v) => !v)} hitSlop={8}>
          <Text style={{ color: c.tint, fontWeight: '700', fontSize: 20 }}>{showForm ? '×' : '+'}</Text>
        </Pressable>
      </View>

      <Text style={{ color: c.textSecondary, fontSize: 12, paddingHorizontal: 16, marginBottom: 8 }}>
        Forward incoming SMS from specific senders to other numbers. Matching can include specific
        amounts and the SIM that received the message.
      </Text>

      {showForm && (
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={[styles.addBox, { borderColor: c.border }]}>
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="Rule name (optional)"
            placeholderTextColor={c.muted}
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />
          <TextInput
            value={senderDraft}
            onChangeText={setSenderDraft}
            placeholder="Sender contains (e.g. MPESA)"
            placeholderTextColor={c.muted}
            autoCapitalize="characters"
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />

          <Text style={[styles.label, { color: c.textSecondary }]}>Source SIM</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pressable
              onPress={() => setSimFilter('any')}
              style={[styles.pill, { borderColor: c.border, backgroundColor: simFilter === 'any' ? c.tint : c.surface }]}>
              <Text style={{ color: simFilter === 'any' ? c.onTint : c.text, fontSize: 12 }}>Any SIM</Text>
            </Pressable>
            {availableSims.map((sim) => (
              <Pressable
                key={sim.subscriptionId}
                onPress={() => setSimFilter(sim.subscriptionId)}
                style={[
                  styles.pill,
                  { borderColor: c.border, backgroundColor: simFilter === sim.subscriptionId ? c.tint : c.surface },
                ]}>
                <Text style={{ color: simFilter === sim.subscriptionId ? c.onTint : c.text, fontSize: 12 }}>
                  SIM {sim.slotIndex + 1}
                  {sim.carrierName ? ` (${sim.carrierName})` : ''}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TextInput
              value={minAmountDraft}
              onChangeText={setMinAmountDraft}
              placeholder="Min amount (optional)"
              placeholderTextColor={c.muted}
              keyboardType="numeric"
              style={[styles.input, { flex: 1, backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
            />
            <TextInput
              value={maxAmountDraft}
              onChangeText={setMaxAmountDraft}
              placeholder="Max amount (optional)"
              placeholderTextColor={c.muted}
              keyboardType="numeric"
              style={[styles.input, { flex: 1, backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
            />
          </View>

          <TextInput
            value={targetDraft}
            onChangeText={setTargetDraft}
            placeholder="Forward to number (07XXXXXXXX)"
            placeholderTextColor={c.muted}
            keyboardType="phone-pad"
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />

          <Pressable style={[styles.addButton, { backgroundColor: c.tint }]} onPress={handleAdd}>
            <Text style={{ color: c.onTint, fontWeight: '700' }}>Add rule</Text>
          </Pressable>
          <Text style={{ color: c.muted, fontSize: 10 }}>
            Requires a native rebuild for the forwarding SMS to actually send — same one-time step
            as other native features in this app.
          </Text>
        </ScrollView>
      )}

      <FlatList
        data={rules}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 40 }}>
            No rules yet. Tap "+" to add your first rule.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: c.border, backgroundColor: c.surface }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>{item.name}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>
                Sender contains "{item.senderPattern || 'any'}" → {item.targetNumber}
              </Text>
              {(item.minAmount != null || item.maxAmount != null) && (
                <Text style={{ color: c.muted, fontSize: 11 }}>
                  Amount {item.minAmount ?? '—'} to {item.maxAmount ?? '—'}
                </Text>
              )}
              <Text style={{ color: c.muted, fontSize: 11 }}>
                {item.matchCount} event{item.matchCount === 1 ? '' : 's'}
                {item.lastMatchedAt ? ` · last ${new Date(item.lastMatchedAt).toLocaleDateString()}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <Pressable onPress={() => toggleRule(item.id)}>
                <Text style={{ color: item.enabled ? c.success : c.muted, fontWeight: '600', fontSize: 12 }}>
                  {item.enabled ? 'On' : 'Off'}
                </Text>
              </Pressable>
              <Pressable onPress={() => handleRemove(item)} hitSlop={8}>
                <Text style={{ color: c.error, fontWeight: '600', fontSize: 12 }}>Remove</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Text style={{ color: c.muted, fontSize: 11, textAlign: 'center', paddingBottom: insets.bottom + 8 }}>
        {rules.length} rule(s) · {totalEvents} event(s)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 17, fontWeight: '700' },
  addBox: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingTop: 4,
    gap: 8,
  },
  label: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
});
