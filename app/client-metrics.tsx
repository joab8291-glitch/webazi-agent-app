import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useClientStore, type ClientRecord } from '@/store/useClientStore';
import { useAppSettingsStore } from '@/store/useAppSettingsStore';

/**
 * Client Metrics dashboard — built entirely from useClientStore, which
 * is populated as a side effect of every completed delivery (see
 * services/clientTracking.ts, hooked into useTransactionStore).
 *
 * "New" / "Churn risk" thresholds are configurable in Settings
 * (newClientWindowDays / churnWindowDays) so this adapts to how often
 * an agent's customers actually tend to reorder.
 */

type Filter = 'all' | 'new' | 'repeat' | 'churn';

export default function ClientMetricsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const clientsMap = useClientStore((s) => s.clients);
  const newClientWindowDays = useAppSettingsStore((s) => s.newClientWindowDays);
  const churnWindowDays = useAppSettingsStore((s) => s.churnWindowDays);

  const [filter, setFilter] = useState<Filter>('all');

  const { all, counts } = useMemo(() => {
    const now = Date.now();
    const newCutoff = now - newClientWindowDays * 24 * 60 * 60 * 1000;
    const churnCutoff = now - churnWindowDays * 24 * 60 * 60 * 1000;

    const list = Object.values(clientsMap).sort(
      (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    );

    let newCount = 0;
    let repeatCount = 0;
    let churnCount = 0;

    for (const client of list) {
      const isNew = new Date(client.firstSeenAt).getTime() >= newCutoff;
      const isChurning = new Date(client.lastSeenAt).getTime() < churnCutoff;
      if (isNew) newCount++;
      if (client.purchaseCount > 1) repeatCount++;
      if (isChurning) churnCount++;
    }

    return {
      all: list,
      counts: { total: list.length, newCount, repeatCount, churnCount, newCutoff, churnCutoff },
    };
  }, [clientsMap, newClientWindowDays, churnWindowDays]);

  const filtered = useMemo(() => {
    if (filter === 'all') return all;
    if (filter === 'new') return all.filter((cl) => new Date(cl.firstSeenAt).getTime() >= counts.newCutoff);
    if (filter === 'repeat') return all.filter((cl) => cl.purchaseCount > 1);
    return all.filter((cl) => new Date(cl.lastSeenAt).getTime() < counts.churnCutoff);
  }, [all, filter, counts]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: c.text, fontSize: 16 }}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Client Metrics</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.statsRow}>
        <StatTile colors={c} label="Total" value={counts.total} active={filter === 'all'} onPress={() => setFilter('all')} />
        <StatTile
          colors={c}
          label={`New (${newClientWindowDays}d)`}
          value={counts.newCount}
          active={filter === 'new'}
          onPress={() => setFilter('new')}
        />
        <StatTile
          colors={c}
          label="Repeat"
          value={counts.repeatCount}
          active={filter === 'repeat'}
          onPress={() => setFilter('repeat')}
        />
        <StatTile
          colors={c}
          label={`Churn risk (${churnWindowDays}d)`}
          value={counts.churnCount}
          active={filter === 'churn'}
          onPress={() => setFilter('churn')}
          warn
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 40 }}>
            No clients in this view yet.
          </Text>
        }
        renderItem={({ item }) => <ClientRow item={item} colors={c} churnCutoff={counts.churnCutoff} />}
      />
    </View>
  );
}

function StatTile({
  colors: c,
  label,
  value,
  active,
  onPress,
  warn,
}: {
  colors: (typeof Colors)['light'];
  label: string;
  value: number;
  active: boolean;
  onPress: () => void;
  warn?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.statTile,
        {
          backgroundColor: active ? (warn ? c.error : c.tint) : c.surface,
          borderColor: c.border,
        },
      ]}>
      <Text style={{ color: active ? c.onTint : c.text, fontWeight: '800', fontSize: 18 }}>{value}</Text>
      <Text style={{ color: active ? c.onTint : c.textSecondary, fontSize: 10 }}>{label}</Text>
    </Pressable>
  );
}

function ClientRow({
  item,
  colors: c,
  churnCutoff,
}: {
  item: ClientRecord;
  colors: (typeof Colors)['light'];
  churnCutoff: number;
}) {
  const isChurning = new Date(item.lastSeenAt).getTime() < churnCutoff;

  return (
    <View style={[styles.row, { borderColor: c.border, backgroundColor: c.surface }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontWeight: '600' }}>{item.name ?? item.phone}</Text>
        {item.name && <Text style={{ color: c.muted, fontSize: 11 }}>{item.phone}</Text>}
        <Text style={{ color: c.muted, fontSize: 11 }}>
          {item.purchaseCount} purchase{item.purchaseCount === 1 ? '' : 's'} · KES {item.totalSpent} total
        </Text>
        <Text style={{ color: c.muted, fontSize: 11 }}>
          Last seen {new Date(item.lastSeenAt).toLocaleDateString()}
        </Text>
      </View>
      {isChurning && (
        <View style={[styles.pill, { backgroundColor: c.error }]}>
          <Text style={{ color: c.onTint, fontSize: 10, fontWeight: '700' }}>At risk</Text>
        </View>
      )}
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
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  statTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  pill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
