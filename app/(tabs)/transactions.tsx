import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTransactionStore } from '@/store/useTransactionStore';
import type { LocalTransaction } from '@/store/useTransactionStore';
import { retryDelivery } from '@/services/smsAutomation';
import { openWhatsAppChat } from '@/services/whatsapp';

type Filter = 'all' | 'pending' | 'completed' | 'failed';

const FILTERS: Filter[] = ['all', 'pending', 'completed', 'failed'];

export default function TransactionsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const transactions = useTransactionStore((s) => s.transactions);
  const [filter, setFilter] = useState<Filter>('all');

  const data = useMemo(
    () => (filter === 'all' ? transactions : transactions.filter((t) => t.status === filter)),
    [transactions, filter]
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <Text style={[styles.title, { color: c.text, paddingHorizontal: 16 }]}>Orders</Text>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              styles.filterChip,
              {
                backgroundColor: filter === f ? c.tint : c.surface,
                borderColor: c.border,
              },
            ]}>
            <Text
              style={{
                color: filter === f ? '#fff' : c.textSecondary,
                fontSize: 12,
                fontWeight: '600',
                textTransform: 'capitalize',
              }}>
              {f}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 40 }}>
            No orders yet
          </Text>
        }
        renderItem={({ item }) => <TxnCard txn={item} colors={c} />}
      />
    </View>
  );
}

function TxnCard({
  txn,
  colors,
}: {
  txn: LocalTransaction;
  colors: (typeof Colors)['light'];
}) {
  const statusColor =
    txn.status === 'completed'
      ? colors.success
      : txn.status === 'failed'
        ? colors.error
        : colors.warning;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>
          KES {txn.amount} · {txn.network === 'airtel' ? 'Airtel' : 'Safaricom'}
        </Text>
        <View style={[styles.badge, { backgroundColor: statusColor + '22' }]}>
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700' }}>
            {txn.status.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{txn.phone}</Text>
      <Text style={{ color: colors.muted, fontSize: 11 }}>Ref: {txn.ref}</Text>
      {txn.receipt ? (
        <Text style={{ color: colors.muted, fontSize: 11 }}>Receipt: {txn.receipt}</Text>
      ) : null}
      {txn.status === 'pending' && txn.deliveredAmount > 0 && (
        <Text style={{ color: colors.warning, fontSize: 12 }}>
          KES {txn.deliveredAmount} of {txn.amount} delivered so far
        </Text>
      )}
      {txn.failureReason ? (
        <Text style={{ color: colors.error, fontSize: 12 }}>{txn.failureReason}</Text>
      ) : null}
      <Text style={{ color: colors.muted, fontSize: 11 }}>
        {new Date(txn.createdAt).toLocaleString()} · attempts {txn.attempts}
      </Text>

      <View style={styles.actions}>
        <Pressable
          onPress={() => openWhatsAppChat(txn.phone)}
          style={[styles.actionBtn, { borderColor: colors.border }]}>
          <Text style={{ color: colors.tint, fontSize: 12, fontWeight: '600' }}>WhatsApp</Text>
        </Pressable>
        {txn.status === 'failed' && (
          <Pressable
            onPress={() => retryDelivery(txn)}
            style={[styles.actionBtn, { borderColor: colors.border }]}>
            <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '600' }}>Requeue</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  actionBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
