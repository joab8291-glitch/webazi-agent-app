import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMessageLogStore } from '@/store/useMessageLogStore';
import type { MessageLogEntry, MessageLogStatus } from '@/store/useMessageLogStore';
import { rerunMessage } from '@/services/smsAutomation';

const STATUS_LABEL: Record<MessageLogStatus, string> = {
  queued: 'Queued',
  duplicate: 'Duplicate',
  no_ref: 'No ref',
  undecodable_ref: 'Bad ref',
  invalid: 'Invalid',
};

export default function MpesaMessagesScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const items = useMessageLogStore((s) => s.items);
  const clear = useMessageLogStore((s) => s.clear);
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const statusColor = (status: MessageLogStatus) => {
    if (status === 'queued') return c.success;
    if (status === 'duplicate') return c.muted;
    return c.warning;
  };

  const handleRerun = (item: MessageLogEntry) => {
    Alert.alert('Rerun this message?', 'Reprocesses it exactly as if it had just arrived.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rerun',
        onPress: () => {
          setRerunningId(item.id);
          try {
            rerunMessage({
              sender: item.sender,
              subscriptionId: item.subscriptionId,
              body: item.body,
            });
          } finally {
            setTimeout(() => setRerunningId(null), 600);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: c.tint, fontSize: 16 }}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>MPESA Messages</Text>
        <Pressable
          onPress={() =>
            Alert.alert('Clear log?', 'This only clears the log — it does not affect orders.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Clear', style: 'destructive', onPress: clear },
            ])
          }
          hitSlop={12}>
          <Text style={{ color: c.error, fontSize: 14 }}>Clear</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={
          <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 4 }}>
            Every SMS from a trusted sender on the Till SIM, parsed or not. Use Rerun to manually
            reprocess one if something silently failed.
          </Text>
        }
        ListEmptyComponent={
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 20 }}>
            No messages logged yet
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.cardTop}>
              <Text style={{ color: c.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                {item.sender}
              </Text>
              <View
                style={[
                  styles.statusChip,
                  { borderColor: statusColor(item.status), backgroundColor: c.background },
                ]}>
                <Text style={{ color: statusColor(item.status), fontSize: 11, fontWeight: '700' }}>
                  {STATUS_LABEL[item.status]}
                </Text>
              </View>
            </View>

            <Text style={{ color: c.textSecondary, fontSize: 13 }} numberOfLines={3}>
              {item.body}
            </Text>

            <Text style={{ color: c.muted, fontSize: 11 }}>
              {new Date(item.receivedAt).toLocaleString()} · sub {item.subscriptionId} ·{' '}
              {item.source}
              {item.ref ? ` · ref ${item.ref}` : ''}
            </Text>

            <Pressable
              onPress={() => handleRerun(item)}
              disabled={rerunningId === item.id}
              style={[
                styles.outlineBtn,
                { borderColor: c.border, alignSelf: 'flex-start', marginTop: 2 },
              ]}>
              <Text style={{ color: c.tint, fontSize: 12, fontWeight: '600' }}>
                {rerunningId === item.id ? 'Rerunning…' : 'Rerun'}
              </Text>
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
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '800' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  outlineBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
});
