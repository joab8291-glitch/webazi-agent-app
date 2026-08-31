import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useBlacklistStore, type BlacklistEntry } from '@/store/useBlacklistStore';

/**
 * Blacklisted Numbers screen — add/remove customer phone numbers that
 * should be restricted from Data Plan deliveries. A payment from a
 * blacklisted number still shows up in Transactions (the money did
 * arrive), but the delivery pipeline skips dialing and fires the
 * "Blacklisted" Notification Template instead — see
 * services/smsAutomation.ts → tryHandleDataPlanPayment.
 */
export default function BlacklistedNumbersScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const items = useBlacklistStore((s) => s.items);
  const add = useBlacklistStore((s) => s.add);
  const remove = useBlacklistStore((s) => s.remove);

  const [phoneDraft, setPhoneDraft] = useState('');
  const [reasonDraft, setReasonDraft] = useState('');

  const handleAdd = () => {
    const phone = phoneDraft.trim();
    if (!phone) return;
    add(phone, reasonDraft.trim() || null);
    setPhoneDraft('');
    setReasonDraft('');
  };

  const handleRemove = (item: BlacklistEntry) => {
    Alert.alert('Remove from blacklist?', item.phone, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(item.id) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: c.text, fontSize: 16 }}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Blacklisted Numbers</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.addBox, { borderColor: c.border }]}>
        <TextInput
          value={phoneDraft}
          onChangeText={setPhoneDraft}
          placeholder="Phone number (07XXXXXXXX)"
          placeholderTextColor={c.muted}
          keyboardType="phone-pad"
          style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
        />
        <TextInput
          value={reasonDraft}
          onChangeText={setReasonDraft}
          placeholder="Reason (optional)"
          placeholderTextColor={c.muted}
          style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
        />
        <Pressable style={[styles.addButton, { backgroundColor: c.tint }]} onPress={handleAdd}>
          <Text style={{ color: c.onTint, fontWeight: '700' }}>Add to blacklist</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 40 }}>
            No blacklisted numbers yet.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: c.border, backgroundColor: c.surface }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>{item.phone}</Text>
              {item.reason ? <Text style={{ color: c.muted, fontSize: 12 }}>{item.reason}</Text> : null}
              <Text style={{ color: c.muted, fontSize: 11 }}>
                Added {new Date(item.addedAt).toLocaleDateString()}
              </Text>
            </View>
            <Pressable onPress={() => handleRemove(item)} hitSlop={8}>
              <Text style={{ color: c.error, fontWeight: '600' }}>Remove</Text>
            </Pressable>
          </View>
        )}
      />
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
  addBox: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingTop: 4,
    gap: 8,
  },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
});
