import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Platform,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors, Gradients, withAlpha, cardShadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSimStore } from '@/store/useSimStore';
import { useActivityStore, LogLevel } from '@/store/useActivityStore';
import { useTransactionStore } from '@/store/useTransactionStore';
import { useAppSettingsStore } from '@/store/useAppSettingsStore';
import {
  startSmsListening,
  stopSmsListening,
  refreshSimSlots,
  requestSmsPermissions,
  requestCallPermission,
} from '@/services/smsAutomation';
import { startSchedulerLoop, stopSchedulerLoop } from '@/services/scheduler';
import { scanMissedMessages } from '@/services/missedMessages';
import { getDueSummaries, markSummaryShown, formatSummary } from '@/services/summary';
import UssdExecutor from '@/modules/ussd-executor/src/UssdExecutorModule';
import { IconSymbol } from '@/components/ui/icon-symbol';

type ThemeColors = (typeof Colors)['light'];

export default function HomeScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const gradient = Gradients[scheme].tint;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { smsListening, tillSubscriptionId, availableSims } = useSimStore();
  const logs = useActivityStore((s) => s.logs);
  const clearLogs = useActivityStore((s) => s.clear);
  const { transactions } = useTransactionStore();
  const statsHidden = useAppSettingsStore((s) => s.statsHidden);
  const setStatsHidden = useAppSettingsStore((s) => s.setStatsHidden);

  const [a11yOk, setA11yOk] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const pendingCount = transactions.filter((t) => t.status === 'pending').length;
  const completedCount = transactions.filter((t) => t.status === 'completed').length;
  const failedCount = transactions.filter((t) => t.status === 'failed').length;
  const totalCount = pendingCount + completedCount + failedCount;
  const successRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const pendingPct = totalCount > 0 ? Math.max(6, Math.round((pendingCount / totalCount) * 100)) : 0;

  const bootstrap = useCallback(async () => {
    refreshSimSlots();
    try {
      setA11yOk(UssdExecutor.isAccessibilityEnabled());
    } catch {
      setA11yOk(false);
    }

    // Purge old completed/failed orders if auto-delete is configured.
    // Pending orders are never touched, regardless of age.
    const { autoDeleteDays, setAutoDeleteLastRunAt } = useAppSettingsStore.getState();
    if (autoDeleteDays != null && autoDeleteDays > 0) {
      useTransactionStore.getState().purgeOlderThan(autoDeleteDays);
      setAutoDeleteLastRunAt(new Date().toISOString());
    }

    // Missed Messages — catch any Till-SIM SMS that arrived while the
    // app/process was killed and the live listener wasn't around to see it.
    scanMissedMessages().catch(() => {});

    // Daily/weekly summary — shown here (app open) rather than pushed,
    // since there's no background task runner installed. Shown after a
    // short delay so it doesn't collide with the missed-messages scan
    // updating the screen underneath it.
    setTimeout(() => {
      const due = getDueSummaries();
      due.forEach((stats) => {
        const { title, body } = formatSummary(stats);
        Alert.alert(title, body || 'No orders in this period.', [
          { text: 'OK', onPress: () => markSummaryShown(stats.period) },
        ]);
      });
    }, 600);
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // USSD Scheduler only fires while the app is open — start/stop the
  // polling loop with this screen's lifecycle.
  useEffect(() => {
    startSchedulerLoop();
    return () => stopSchedulerLoop();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await bootstrap();
    setRefreshing(false);
  };

  const toggleSms = async () => {
    if (smsListening) {
      stopSmsListening();
    } else {
      await startSmsListening();
    }
  };

  const ensurePermissions = async () => {
    await requestSmsPermissions();
    await requestCallPermission();
    try {
      if (!UssdExecutor.isAccessibilityEnabled()) {
        UssdExecutor.openAccessibilitySettings();
      }
      setA11yOk(UssdExecutor.isAccessibilityEnabled());
    } catch {
      // module may not be available on web/simulator
    }
    refreshSimSlots();
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={[
        styles.container,
        // Extra bottom padding so content clears the floating pill tab bar.
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 110 },
      ]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}>
      {/* Greeting header */}
      <View style={styles.headerRow}>
        <View style={styles.greetingLeft}>
          <LinearGradient colors={gradient} style={styles.avatar}>
            <Text style={[styles.avatarText, { color: c.onTint }]}>W</Text>
          </LinearGradient>
          <View>
            <Text style={[styles.hello, { color: c.textSecondary }]}>{greeting()}</Text>
            <Text style={[styles.name, { color: c.text }]}>Webazi Agent</Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.push('/notifications')}
          style={[styles.bell, { backgroundColor: c.surface, borderColor: c.border }]}>
          {failedCount > 0 && (
            <View style={[styles.badge, { backgroundColor: c.error, borderColor: c.surface }]} />
          )}
          <IconSymbol name="bell.fill" size={18} color={c.textSecondary} />
        </Pressable>
      </View>

      {/* Hero card */}
      <LinearGradient
        colors={[c.surface, c.surfaceAlt]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.hero, { borderColor: c.border }, cardShadow()]}>
        <View style={styles.heroTop}>
          <View>
            <Text style={[styles.heroLabel, { color: c.textSecondary }]}>Today&apos;s queue</Text>
            <Text style={[styles.heroValue, { color: c.text }]}>
              {statsHidden ? '•••' : totalCount} <Text style={[styles.heroValueUnit, { color: c.textSecondary }]}>orders</Text>
            </Text>
          </View>
          <Pressable
            onPress={() => setStatsHidden(!statsHidden)}
            hitSlop={8}
            style={[
              styles.heroBadge,
              {
                backgroundColor: withAlpha(smsListening ? c.success : c.muted, 0.16),
                borderColor: withAlpha(smsListening ? c.success : c.muted, 0.4),
              },
            ]}>
            <View
              style={[styles.heroBadgeDot, { backgroundColor: smsListening ? c.success : c.muted }]}
            />
            <Text style={{ color: smsListening ? c.success : c.muted, fontSize: 11, fontWeight: '700' }}>
              {smsListening ? 'Live' : 'Paused'}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.gradientBarTrack, { backgroundColor: c.warning }]}>
          <View
            style={[
              styles.gradientBarFill,
              { backgroundColor: c.success, left: `${pendingPct}%` },
            ]}
          />
        </View>
        <View style={styles.barCaption}>
          <Text style={{ color: c.textSecondary, fontSize: 11 }}>{pendingCount} pending</Text>
          <Text style={{ color: c.textSecondary, fontSize: 11 }}>{successRate}% success rate</Text>
        </View>

        <View style={[styles.heroSub, { borderTopColor: c.border }]}>
          <HeroStat label="Pending" value={pendingCount} color={c.warning} hidden={statsHidden} labelColor={c.textSecondary} />
          <HeroStat label="Done" value={completedCount} color={c.success} hidden={statsHidden} labelColor={c.textSecondary} />
          <HeroStat label="Failed" value={failedCount} color={c.error} hidden={statsHidden} labelColor={c.textSecondary} />
        </View>
      </LinearGradient>

      {/* System status — ring selectors */}
      <View>
        <Text style={[styles.sectionLabel, { color: c.text }]}>System status</Text>
        <View style={styles.selectorRow}>
          <SelectorRing
            icon="accessibility.fill"
            label="Accessibility"
            ok={a11yOk}
            colors={c}
          />
          <SelectorRing icon="antenna.radiowaves.left.and.right" label="SMS" ok={smsListening} colors={c} />
          <SelectorRing
            icon="simcard.fill"
            label="SIM 1"
            ok={availableSims.length > 0}
            colors={c}
          />
          <SelectorRing
            icon="simcard.fill"
            label="SIM 2"
            ok={availableSims.length > 1}
            colors={c}
          />
        </View>
      </View>

      {/* Quick actions */}
      <View>
        <Text style={[styles.sectionLabel, { color: c.text }]}>Quick actions</Text>
        <View style={styles.tileRow}>
          <QuickTile
            icon="list.bullet"
            label="Orders"
            colors={c}
            onPress={() => router.push('/transactions')}
          />
          <QuickTile
            icon="simcard.fill"
            label="Data Plans"
            colors={c}
            onPress={() => router.push('/data-plans-manager')}
          />
          <QuickTile
            icon="clock.fill"
            label="Scheduler"
            colors={c}
            onPress={() => router.push('/ussd-scheduler')}
          />
          <QuickTile
            icon="tray.fill"
            label="Messages"
            colors={c}
            onPress={() => router.push('/mpesa-messages')}
          />
        </View>
      </View>

      {/* Automation */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, cardShadow()]}>
        <Text style={[styles.cardTitle, { color: c.text }]}>Automation</Text>

        <Row
          label="SMS auto-dial"
          hint="Listen for M-Pesa SMS and fulfill instantly"
          value={smsListening}
          onToggle={toggleSms}
          colors={c}
        />

        <Pressable onPress={ensurePermissions}>
          <LinearGradient colors={gradient} style={styles.pillBtn}>
            <Text style={[styles.pillBtnText, { color: c.onTint }]}>Grant permissions &amp; refresh SIMs</Text>
          </LinearGradient>
        </Pressable>

        {availableSims.length > 0 && (
          <Text style={[styles.hint, { color: c.textSecondary }]}>
            SIMs: {availableSims.map((s) => s.carrierName || `slot ${s.slotIndex}`).join(', ')}{'\n'}
            Till SIM: {tillSubscriptionId != null ? `sub ${tillSubscriptionId}` : 'not set — open Settings'}
          </Text>
        )}
      </View>

      {/* Activity */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, cardShadow()]}>
        <View style={styles.logHeader}>
          <Text style={[styles.cardTitle, { color: c.text }]}>Activity</Text>
          <Pressable onPress={clearLogs}>
            <Text style={{ color: c.tint, fontSize: 12, fontWeight: '600' }}>Clear</Text>
          </Pressable>
        </View>
        {logs.length === 0 ? (
          <Text style={[styles.hint, { color: c.muted }]}>No activity yet</Text>
        ) : (
          logs.slice(0, 30).map((entry) => (
            <ActivityRow
              key={entry.id}
              level={entry.level}
              message={entry.message}
              timestamp={entry.timestamp}
              amount={entry.amount}
              phone={entry.phone}
              colors={c}
            />
          ))
        )}
      </View>

      {Platform.OS !== 'android' && (
        <Text style={[styles.hint, { color: c.warning, marginTop: 4 }]}>
          Native USSD / SMS modules require an Android device or emulator with a development build.
        </Text>
      )}
    </ScrollView>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function HeroStat({
  label,
  value,
  color,
  hidden,
  labelColor,
}: {
  label: string;
  value: number;
  color: string;
  hidden?: boolean;
  labelColor: string;
}) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Text style={{ fontSize: 16, fontWeight: '800', color }}>{hidden ? '•••' : value}</Text>
      <Text style={{ fontSize: 11, marginTop: 1, color: labelColor }}>{label}</Text>
    </View>
  );
}

function SelectorRing({
  icon,
  label,
  ok,
  colors,
}: {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  label: string;
  ok: boolean | null;
  colors: ThemeColors;
}) {
  const state = ok === null ? 'unknown' : ok ? 'ok' : 'bad';
  const ringColor = state === 'ok' ? colors.success : state === 'bad' ? colors.error : colors.muted;
  return (
    <View style={styles.selectorItem}>
      <View
        style={[
          styles.selectorRing,
          { borderColor: ringColor, backgroundColor: withAlpha(ringColor, 0.1) },
        ]}>
        <IconSymbol name={icon} size={20} color={ringColor} />
        {state !== 'unknown' && (
          <View
            style={[
              styles.selectorCheck,
              { backgroundColor: ringColor, borderColor: colors.background },
            ]}>
            <IconSymbol
              name={state === 'ok' ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill'}
              size={10}
              color={colors.onTint}
            />
          </View>
        )}
      </View>
      <Text style={[styles.selectorLabel, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function QuickTile({
  icon,
  label,
  colors,
  onPress,
}: {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  label: string;
  colors: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}>
      <View style={[styles.tileIcon, { backgroundColor: colors.surfaceAlt }]}>
        <IconSymbol name={icon} size={17} color={colors.tint} />
      </View>
      <Text style={[styles.tileLabel, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  label,
  hint,
  value,
  onToggle,
  colors,
}: {
  label: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ true: colors.tint, false: colors.border }}
      />
    </View>
  );
}

function ActivityRow({
  level,
  message,
  timestamp,
  amount,
  phone,
  colors,
}: {
  level: LogLevel;
  message: string;
  timestamp: number;
  amount?: number;
  phone?: string;
  colors: ThemeColors;
}) {
  const meta = activityMeta(level, colors);
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const amountColor = level === 'success' ? colors.success : colors.textSecondary;
  return (
    <View style={styles.activityItem}>
      <View style={[styles.activityIcon, { backgroundColor: withAlpha(meta.color, 0.14) }]}>
        <IconSymbol name={meta.icon} size={15} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.activityTitle, { color: colors.text }]} numberOfLines={1}>
          {message}
        </Text>
        <Text style={[styles.activitySub, { color: colors.textSecondary }]} numberOfLines={1}>
          {phone ? `${time} · ${phone}` : time}
        </Text>
      </View>
      <Text style={[styles.activityAmount, { color: amountColor }]}>
        {amount != null ? `Ksh ${amount}` : '—'}
      </Text>
    </View>
  );
}

function activityMeta(level: LogLevel, colors: ThemeColors): {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  color: string;
} {
  switch (level) {
    case 'success':
      return { icon: 'checkmark.circle.fill', color: colors.success };
    case 'error':
      return { icon: 'exclamationmark.circle.fill', color: colors.error };
    case 'warn':
      return { icon: 'arrow.triangle.2.circlepath', color: colors.warning };
    default:
      return { icon: 'clock.fill', color: colors.textSecondary };
  }
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 16 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greetingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '800' },
  hello: { fontSize: 12 },
  name: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2, marginTop: 1 },
  bell: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 2,
    zIndex: 1,
  },

  hero: { borderRadius: 22, borderWidth: 1, padding: 20, gap: 14 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  heroValue: { fontSize: 34, fontWeight: '800', letterSpacing: -1, marginTop: 4 },
  heroValueUnit: { fontSize: 18, fontWeight: '700' },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  heroBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  gradientBarTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  gradientBarFill: { position: 'absolute', top: 0, bottom: 0, right: 0, left: 0 },
  barCaption: { flexDirection: 'row', justifyContent: 'space-between' },
  heroSub: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1 },

  sectionLabel: { fontSize: 13, fontWeight: '700', marginBottom: 10 },

  selectorRow: { flexDirection: 'row', gap: 12 },
  selectorItem: { flex: 1, alignItems: 'center', gap: 6 },
  selectorRing: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorCheck: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },

  tileRow: { flexDirection: 'row', gap: 10 },
  tile: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 6,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: 10.5, fontWeight: '600', textAlign: 'center' },

  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  cardTitle: { fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pillBtn: { borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
  pillBtnText: { fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
  hint: { fontSize: 12, lineHeight: 18 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  activityItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  activityIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  activityTitle: { fontSize: 13, fontWeight: '600' },
  activitySub: { fontSize: 11, marginTop: 1 },
  activityAmount: { fontSize: 13, fontWeight: '700', marginLeft: 8, flexShrink: 0 },
});
