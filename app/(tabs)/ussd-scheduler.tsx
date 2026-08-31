import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useScheduleStore } from '@/store/useScheduleStore';
import type { ScheduledDial, ScheduleRecurrence } from '@/store/useScheduleStore';

type Network = 'safaricom' | 'airtel';

const RECURRENCES: { key: ScheduleRecurrence; label: string }[] = [
  { key: 'once', label: 'Once' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
];

export default function UssdSchedulerScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const [showForm, setShowForm] = useState(false);

  const items = useScheduleStore((s) => s.items);
  const removeSchedule = useScheduleStore((s) => s.removeSchedule);
  const setActive = useScheduleStore((s) => s.setActive);

  const handleDelete = (item: ScheduledDial) => {
    Alert.alert('Delete schedule?', item.label || `${item.phone} · KES ${item.amount}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeSchedule(item.id) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: c.tint, fontSize: 16 }}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>USSD Scheduler</Text>
        <View style={{ width: 44 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 4 }}>
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              Runs only while the app is open — a schedule due while the app was closed fires as soon
              as you reopen it.
            </Text>
            <Pressable
              onPress={() => setShowForm((v) => !v)}
              style={[styles.outlineBtn, { borderColor: c.border }]}>
              <Text style={{ color: c.tint, fontWeight: '600' }}>
                {showForm ? 'Hide form' : '+ New schedule'}
              </Text>
            </Pressable>
            {showForm && <ScheduleForm colors={c} onDone={() => setShowForm(false)} />}
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 20 }}>
            No scheduled USSDs yet
          </Text>
        }
        renderItem={({ item }) => (
          <ScheduleCard
            item={item}
            colors={c}
            onDelete={() => handleDelete(item)}
            onToggleActive={(v) => setActive(item.id, v)}
          />
        )}
      />
    </View>
  );
}

function ScheduleForm({
  colors,
  onDone,
}: {
  colors: (typeof Colors)['light'];
  onDone: () => void;
}) {
  const addSchedule = useScheduleStore((s) => s.addSchedule);

  const now = new Date();
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState<Network>('safaricom');
  const [date, setDate] = useState(now.toISOString().slice(0, 10)); // YYYY-MM-DD
  const [time, setTime] = useState(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  );
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>('once');
  const [limit, setLimit] = useState('');

  const submit = () => {
    const amt = Number(amount);
    if (!phone.trim() || !Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Check the form', 'Enter a valid phone number and amount.');
      return;
    }

    const runAt = new Date(`${date}T${time}:00`);
    if (isNaN(runAt.getTime())) {
      Alert.alert('Check the date/time', 'Use format YYYY-MM-DD and HH:MM.');
      return;
    }

    const limitNum = limit.trim() ? Number(limit) : null;

    addSchedule({
      label: label.trim() || `${network} KES ${amt} to ${phone.trim()}`,
      phone: phone.trim(),
      amount: amt,
      network,
      runAt: runAt.toISOString(),
      recurrence,
      limit: limitNum && limitNum > 0 ? limitNum : null,
    });

    setLabel('');
    setPhone('');
    setAmount('');
    setLimit('');
    onDone();
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>Label (optional)</Text>
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Short label to identify this schedule"
        placeholderTextColor={colors.muted}
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
      />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['safaricom', 'airtel'] as Network[]).map((n) => (
          <Pressable
            key={n}
            onPress={() => setNetwork(n)}
            style={[
              styles.netChip,
              {
                borderColor: colors.border,
                backgroundColor: network === n ? colors.tint : colors.background,
              },
            ]}>
            <Text
              style={{
                color: network === n ? '#fff' : colors.textSecondary,
                fontWeight: '600',
                fontSize: 12,
                textTransform: 'capitalize',
              }}>
              {n}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="Phone (07XXXXXXXX)"
        placeholderTextColor={colors.muted}
        keyboardType="phone-pad"
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
      />
      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="Amount (KES)"
        placeholderTextColor={colors.muted}
        keyboardType="numeric"
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
      />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Date</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Time</Text>
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="HH:MM"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          />
        </View>
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>Recurrence</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {RECURRENCES.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => setRecurrence(r.key)}
            style={[
              styles.netChip,
              {
                borderColor: colors.border,
                backgroundColor: recurrence === r.key ? colors.tint : colors.background,
              },
            ]}>
            <Text
              style={{
                color: recurrence === r.key ? '#fff' : colors.textSecondary,
                fontWeight: '600',
                fontSize: 12,
              }}>
              {r.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {recurrence !== 'once' && (
        <>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Limit (optional, total runs)</Text>
          <TextInput
            value={limit}
            onChangeText={setLimit}
            placeholder="Leave blank for unlimited"
            placeholderTextColor={colors.muted}
            keyboardType="numeric"
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          />
        </>
      )}

      <Pressable onPress={submit} style={[styles.primaryBtn, { backgroundColor: colors.tint }]}>
        <Text style={styles.primaryBtnText}>Schedule</Text>
      </Pressable>
    </View>
  );
}

function ScheduleCard({
  item,
  colors,
  onDelete,
  onToggleActive,
}: {
  item: ScheduledDial;
  colors: (typeof Colors)['light'];
  onDelete: () => void;
  onToggleActive: (v: boolean) => void;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {item.label}
        </Text>
        <Switch
          value={item.active}
          onValueChange={onToggleActive}
          trackColor={{ true: colors.tint, false: colors.border }}
        />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
        {item.network} · KES {item.amount} · {item.phone}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Next run: {new Date(item.runAt).toLocaleString()} · {item.recurrence}
        {item.limit != null ? ` · limit ${item.limit}` : ''}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Runs so far: {item.runsCompleted}
        {item.lastRunAt ? ` · last: ${new Date(item.lastRunAt).toLocaleString()}` : ''}
      </Text>
      {item.lastRunResult && (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Result: {item.lastRunResult}</Text>
      )}
      <Pressable
        onPress={onDelete}
        style={[styles.outlineBtn, { borderColor: colors.border, alignSelf: 'flex-start', marginTop: 4 }]}>
        <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>Delete</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '800' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  outlineBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  primaryBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  label: { fontSize: 12, fontWeight: '600' },
  netChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
});
