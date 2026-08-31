import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTransactionStore, LocalTransaction } from '@/store/useTransactionStore';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { exportOrdersCsv } from '@/services/exportCsv';

type ThemeColors = (typeof Colors)['light'];
type FilterKey = 'all' | 'pending' | 'failed' | 'completed';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
  { key: 'completed', label: 'Completed' },
];

export default function NotificationsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const { transactions, clearAll } = useTransactionStore();
  const [filter, setFilter] = useState<FilterKey>('all');

  const handleClearAll = () => {
    if (transactions.length === 0) return;
    Alert.alert(
      'Clear all notifications?',
      'This deletes every order shown here — including any still pending delivery. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: () => clearAll() },
      ]
    );
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return transactions;
    return transactions.filter((t) => t.status === filter);
  }, [transactions, filter]);

  const counts = useMemo(
    () => ({
      pending: transactions.filter((t) => t.status === 'pending').length,
      failed: transactions.filter((t) => t.status === 'failed').length,
      completed: transactions.filter((t) => t.status === 'completed').length,
    }),
    [transactions]
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: c.tint, fontSize: 16 }}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Notifications</Text>
        <Pressable onPress={handleClearAll} hitSlop={12} style={{ width: 64, alignItems: 'flex-end' }}>
          <Text
            style={{
              color: transactions.length ? c.error : c.muted,
              fontSize: 13,
              fontWeight: '600',
            }}>
            Clear all
          </Text>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 16, alignItems: 'flex-end', marginBottom: 4 }}>
        <Pressable
          onPress={() => {
            if (filtered.length === 0) return;
            exportOrdersCsv(filtered, filter === 'all' ? 'All orders' : `${filter} orders`).catch(() => {});
          }}
          hitSlop={8}>
          <Text
            style={{
              color: filtered.length ? c.tint : c.muted,
              fontSize: 12,
              fontWeight: '600',
            }}>
            Export CSV ({filtered.length})
          </Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count =
            f.key === 'all' ? transactions.length : counts[f.key as Exclude<FilterKey, 'all'>];
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? c.tint : c.surface,
                  borderColor: active ? c.tint : c.border,
                },
              ]}>
              <Text
                style={{
                  color: active ? c.onTint : c.textSecondary,
                  fontSize: 12,
                  fontWeight: '700',
                }}>
                {f.label} · {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.bottom + 32,
          gap: 10,
        }}
        ListEmptyComponent={
          <Text style={[styles.hint, { color: c.muted }]}>Nothing here yet</Text>
        }
        renderItem={({ item }) => <TransactionRow txn={item} colors={c} />}
      />
    </View>
  );
}

function TransactionRow({ txn, colors }: { txn: LocalTransaction; colors: ThemeColors }) {
  const meta = statusMeta(txn.status, colors);
  const time = new Date(txn.updatedAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.icon, { backgroundColor: withAlpha(meta.color, 0.14) }]}>
        <IconSymbol name={meta.icon} size={16} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {txn.phone} · Ksh {txn.amount}
        </Text>
        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
          {txn.network === 'safaricom' ? 'Safaricom' : 'Airtel'} · {time}
        </Text>
        {txn.status === 'failed' && txn.failureReason ? (
          <Text style={[styles.rowReason, { color: colors.error }]} numberOfLines={2}>
            {txn.failureReason}
          </Text>
        ) : null}
      </View>
      <View style={[styles.statusChip, { borderColor: meta.color }]}>
        <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>{meta.label}</Text>
      </View>
    </View>
  );
}

function statusMeta(
  status: LocalTransaction['status'],
  colors: ThemeColors
): { icon: Parameters<typeof IconSymbol>[0]['name']; color: string; label: string } {
  switch (status) {
    case 'completed':
      return { icon: 'checkmark.circle.fill', color: colors.success, label: 'Completed' };
    case 'failed':
      return { icon: 'exclamationmark.circle.fill', color: colors.error, label: 'Failed' };
    default:
      return { icon: 'clock.fill', color: colors.warning, label: 'Pending' };
  }
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
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    flexWrap: 'wrap',
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  hint: { fontSize: 12, lineHeight: 18, paddingHorizontal: 4, marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13, fontWeight: '600' },
  rowSub: { fontSize: 11, marginTop: 1 },
  rowReason: { fontSize: 11, marginTop: 3 },
  statusChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
});
