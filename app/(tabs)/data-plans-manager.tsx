import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  Share,
  Modal,
  ScrollView,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useDataPlanStore,
  emptyPlanDraft,
  makeDefaultVariant,
  type DataPlan,
  type PaymentMode,
  type SimChoice,
  type UssdType,
  type UssdVariant,
} from '@/store/useDataPlanStore';
import { variantActiveAt } from '@/services/dataPlanMatcher';
import {
  exportPlansToFile,
  pickPlansImportFile,
  isValidImportedPlan,
} from '@/services/planExport';

const PAYMENT_MODES: PaymentMode[] = ['Till SIM', 'Paybill SIM', 'Personal SIM'];
const SIM_CHOICES: SimChoice[] = ['SIM 1', 'SIM 2'];
const USSD_TYPES: UssdType[] = ['simple', 'advanced', 'normal'];

export default function DataPlansManagerScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const plans = useDataPlanStore((s) => s.plans);
  const addPlan = useDataPlanStore((s) => s.addPlan);
  const updatePlan = useDataPlanStore((s) => s.updatePlan);
  const deletePlan = useDataPlanStore((s) => s.deletePlan);
  const copyPlan = useDataPlanStore((s) => s.copyPlan);
  const bulkAdjustPrices = useDataPlanStore((s) => s.bulkAdjustPrices);
  const exportPlansJson = useDataPlanStore((s) => s.exportPlansJson);
  const importPlans = useDataPlanStore((s) => s.importPlans);

  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPercent, setBulkPercent] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    plans.forEach((p) => set.add(p.category));
    return Array.from(set);
  }, [plans]);

  const visiblePlans = useMemo(() => {
    let data = category === 'All' ? plans : plans.filter((p) => p.category === category);
    const q = search.trim().toLowerCase();
    if (q) data = data.filter((p) => p.name.toLowerCase().includes(q) || p.ussd.toLowerCase().includes(q));
    return data;
  }, [plans, category, search]);

  const editingPlan = plans.find((p) => p.id === editingId) ?? null;

  const handleDelete = (plan: DataPlan) => {
    Alert.alert('Delete plan?', plan.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePlan(plan.id) },
    ]);
  };

  const handleShareAll = () => {
    if (plans.length === 0) return;
    const lines = plans
      .filter((p) => p.enabled)
      .map((p) => `${p.name} — KES ${p.sellingPrice}`)
      .join('\n');
    Share.share({ message: lines }).catch(() => {});
  };

  /**
   * Exports all plans as a .json file another agent can import to set up
   * matching plans on their own device (see services/planExport.ts).
   */
  const handleExportJson = async () => {
    if (plans.length === 0 || exporting) return;
    setExporting(true);
    try {
      const json = exportPlansJson();
      await exportPlansToFile(json);
    } catch (e: any) {
      Alert.alert('Export failed', String(e?.message ?? e));
    } finally {
      setExporting(false);
    }
  };

  /**
   * Lets this agent pick a Data Plans .json file exported by another agent
   * (via handleExportJson above) and import it into their own plans.
   */
  const handleImportJson = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const picked = await pickPlansImportFile();
      if (!picked) return; // agent cancelled the picker

      const validPlans = picked.parsed.plans.filter(isValidImportedPlan);
      const skipped = picked.parsed.plans.length - validPlans.length;

      if (validPlans.length === 0) {
        Alert.alert('Nothing to import', 'That file had no valid plans in it.');
        return;
      }

      Alert.alert(
        `Import ${validPlans.length} plan${validPlans.length === 1 ? '' : 's'}?`,
        `From "${picked.fileName}"${skipped > 0 ? ` (${skipped} entr${skipped === 1 ? 'y' : 'ies'} skipped as invalid)` : ''}.\n\nAdd these to your existing plans, or replace your plans entirely?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add to existing',
            onPress: () => {
              const { imported } = importPlans(validPlans, 'merge');
              Alert.alert('Imported', `Added ${imported} plan${imported === 1 ? '' : 's'}.`);
            },
          },
          {
            text: 'Replace all',
            style: 'destructive',
            onPress: () => {
              const { imported } = importPlans(validPlans, 'replace');
              Alert.alert('Imported', `Replaced your plans with ${imported} imported plan${imported === 1 ? '' : 's'}.`);
            },
          },
        ]
      );
    } catch (e: any) {
      Alert.alert('Import failed', String(e?.message ?? e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]}>Data Plans Manager</Text>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Pressable onPress={handleImportJson} hitSlop={8} disabled={importing}>
            <Text style={{ color: c.text, fontSize: 16, opacity: importing ? 0.4 : 1 }}>⇩ Import</Text>
          </Pressable>
          <Pressable onPress={handleExportJson} hitSlop={8} disabled={exporting || plans.length === 0}>
            <Text
              style={{
                color: c.text,
                fontSize: 16,
                opacity: exporting || plans.length === 0 ? 0.4 : 1,
              }}>
              ⇧ Export
            </Text>
          </Pressable>
          <Pressable onPress={() => setBulkOpen(true)} hitSlop={8}>
            <Text style={{ color: c.text, fontSize: 18 }}>%</Text>
          </Pressable>
          <Pressable onPress={() => setCreating(true)} hitSlop={8}>
            <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>+</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}>
        {categories.map((cat) => {
          const selected = cat === category;
          return (
            <Pressable
              key={cat}
              onPress={() => setCategory(cat)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? c.tint : c.surface,
                  borderColor: selected ? c.tint : c.border,
                },
              ]}>
              <Text style={{ color: selected ? c.onTint : c.textSecondary, fontSize: 12, fontWeight: '600' }}>
                {selected ? '✓ ' : ''}
                {cat}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search plans by name or USSD…"
          placeholderTextColor={c.muted}
          style={[styles.search, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
        />
      </View>

      <FlatList
        data={visiblePlans}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 90 }}
        ListEmptyComponent={
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 60 }}>
            {plans.length === 0 ? 'No plans yet. Tap "+" to add your first plan.' : 'No plans match this filter.'}
          </Text>
        }
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            colors={c}
            onEdit={() => setEditingId(item.id)}
            onDelete={() => handleDelete(item)}
            onCopy={() => copyPlan(item.id)}
            onToggleEnabled={() => updatePlan(item.id, { enabled: !item.enabled })}
          />
        )}
      />

      {plans.length > 0 && (
        <Pressable
          onPress={handleShareAll}
          style={[
            styles.fab,
            { backgroundColor: c.tint, bottom: insets.bottom + 16 },
          ]}>
          <Text style={{ color: c.onTint, fontWeight: '700' }}>↗ Share plans</Text>
        </Pressable>
      )}

      {/* Bulk price adjust */}
      <Modal visible={bulkOpen} transparent animationType="slide" onRequestClose={() => setBulkOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.sheetTitle, { color: c.text }]}>Bulk adjust prices</Text>
            <Text style={{ color: c.textSecondary, fontSize: 12, marginBottom: 8 }}>
              Applies to "{category}" plans. Use a negative number to discount.
            </Text>
            <TextInput
              value={bulkPercent}
              onChangeText={setBulkPercent}
              placeholder="e.g. 10 or -5"
              placeholderTextColor={c.muted}
              keyboardType="numbers-and-punctuation"
              style={[styles.search, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable
                onPress={() => setBulkOpen(false)}
                style={[styles.btnOutline, { borderColor: c.border, flex: 1 }]}>
                <Text style={{ color: c.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const pct = Number(bulkPercent);
                  if (Number.isFinite(pct)) bulkAdjustPrices(pct, category);
                  setBulkOpen(false);
                  setBulkPercent('');
                }}
                style={[styles.btnSolid, { backgroundColor: c.tint, flex: 1 }]}>
                <Text style={{ color: c.onTint, fontWeight: '700' }}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create / Edit plan */}
      <Modal
        visible={creating || !!editingPlan}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setCreating(false);
          setEditingId(null);
        }}>
        <PlanEditor
          colors={c}
          initial={editingPlan}
          onCancel={() => {
            setCreating(false);
            setEditingId(null);
          }}
          onSave={(draft) => {
            if (editingPlan) {
              updatePlan(editingPlan.id, draft);
            } else {
              addPlan(draft);
            }
            setCreating(false);
            setEditingId(null);
          }}
        />
      </Modal>
    </View>
  );
}

function PlanCard({
  plan,
  colors,
  onEdit,
  onDelete,
  onCopy,
  onToggleEnabled,
}: {
  plan: DataPlan;
  colors: (typeof Colors)['light'];
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onToggleEnabled: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 }}>{plan.name}</Text>
        <Pressable onPress={() => setMenuOpen((v) => !v)} hitSlop={8}>
          <Text style={{ color: colors.muted, fontSize: 18, fontWeight: '700' }}>⋮</Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.tint, fontSize: 12, fontWeight: '600' }}>{plan.category}</Text>

      {menuOpen && (
        <View style={[styles.menu, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onEdit();
            }}
            style={styles.menuItem}>
            <Text style={{ color: colors.text }}>Edit</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onCopy();
            }}
            style={styles.menuItem}>
            <Text style={{ color: colors.text }}>Copy</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onDelete();
            }}
            style={styles.menuItem}>
            <Text style={{ color: colors.error }}>Delete</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.rowBetween}>
        <Pressable
          onPress={onToggleEnabled}
          style={[
            styles.badge,
            { backgroundColor: plan.enabled ? withAlpha(colors.success, 0.15) : withAlpha(colors.muted, 0.15) },
          ]}>
          <Text style={{ color: plan.enabled ? colors.success : colors.muted, fontSize: 11, fontWeight: '700' }}>
            {plan.enabled ? '✓ Enabled' : 'Disabled'}
          </Text>
        </Pressable>
        <View
          style={[
            styles.badge,
            { backgroundColor: plan.pointsEnabled ? withAlpha(colors.tint, 0.15) : withAlpha(colors.muted, 0.15) },
          ]}>
          <Text style={{ color: plan.pointsEnabled ? colors.tint : colors.muted, fontSize: 11, fontWeight: '700' }}>
            Points: {plan.pointsEnabled ? 'On' : 'Off'}
          </Text>
        </View>
      </View>

      <View style={styles.grid2}>
        <InfoLine label="USSD" value={plan.timeConfigured ? `${plan.ussdVariants.length} time variants` : plan.ussd || '—'} colors={colors} />
        <InfoLine label="Payment Mode" value={plan.paymentMode} colors={colors} />
        <InfoLine label="Selling Price" value={`KES ${plan.sellingPrice}`} colors={colors} />
        <InfoLine label="Safaricom Price" value={`KES ${plan.safaricomPrice}`} colors={colors} />
        <InfoLine label="Execute SIM" value={plan.executeSim} colors={colors} />
        <InfoLine label="Notification SIM" value={plan.notificationSim} colors={colors} />
        <InfoLine
          label="Auto Retry"
          value={plan.autoRetry ? `On • ${plan.retryCount}x • ${[plan.retryOnPending && 'Pending', plan.retryOnFailed && 'Failed'].filter(Boolean).join('/')}` : 'Off'}
          colors={colors}
        />
        <InfoLine label="Type" value={plan.ussdType} colors={colors} />
      </View>

      {plan.timeConfigured && (
        <View style={{ gap: 4, marginTop: 4 }}>
          {plan.ussdVariants.map((v) => {
            const isActiveNow = variantActiveAt(v);
            return (
              <Text key={v.id} style={{ color: isActiveNow ? colors.tint : colors.muted, fontSize: 11 }}>
                {isActiveNow ? '● ' : '○ '}
                {v.label}: {v.ussd || '(no USSD set)'}
                {isActiveNow ? ' — active now' : ''}
              </Text>
            );
          })}
        </View>
      )}

      <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
        Last updated: {new Date(plan.updatedAt).toLocaleString()}
      </Text>
    </View>
  );
}

function InfoLine({ label, value, colors }: { label: string; value: string; colors: (typeof Colors)['light'] }) {
  return (
    <View style={{ width: '48%' }}>
      <Text style={{ color: colors.muted, fontSize: 10 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

function PlanEditor({
  colors,
  initial,
  onCancel,
  onSave,
}: {
  colors: (typeof Colors)['light'];
  initial: DataPlan | null;
  onCancel: () => void;
  onSave: (draft: Omit<DataPlan, 'id' | 'createdAt' | 'updatedAt'>) => void;
}) {
  const [draft, setDraft] = useState<Omit<DataPlan, 'id' | 'createdAt' | 'updatedAt'>>(
    initial
      ? {
          category: initial.category,
          name: initial.name,
          enabled: initial.enabled,
          pointsEnabled: initial.pointsEnabled,
          sellingPrice: initial.sellingPrice,
          safaricomPrice: initial.safaricomPrice,
          paymentMode: initial.paymentMode,
          executeSim: initial.executeSim,
          notificationSim: initial.notificationSim,
          ussdType: initial.ussdType,
          autoRetry: initial.autoRetry,
          retryCount: initial.retryCount,
          retryOnPending: initial.retryOnPending,
          retryOnFailed: initial.retryOnFailed,
          timeConfigured: initial.timeConfigured,
          ussd: initial.ussd,
          ussdVariants: initial.ussdVariants,
        }
      : emptyPlanDraft()
  );

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const addVariant = () => {
    const label = draft.ussdVariants.length === 0 ? 'Day (4PM–11PM)' : 'Night (11PM–3:59AM)';
    const defaults =
      draft.ussdVariants.length === 0
        ? { startHour: 16, startMinute: 0, endHour: 23, endMinute: 0 }
        : { startHour: 23, startMinute: 0, endHour: 3, endMinute: 59 };
    set('ussdVariants', [...draft.ussdVariants, { ...makeDefaultVariant(label), ...defaults }]);
  };

  const updateVariant = (id: string, patch: Partial<UssdVariant>) =>
    set(
      'ussdVariants',
      draft.ussdVariants.map((v) => (v.id === id ? { ...v, ...patch } : v))
    );

  const removeVariant = (id: string) =>
    set('ussdVariants', draft.ussdVariants.filter((v) => v.id !== id));

  const canSave = draft.name.trim().length > 0 && (draft.timeConfigured ? draft.ussdVariants.length > 0 : draft.ussd.trim().length > 0);

  return (
    <View style={styles.modalOverlay}>
      <View style={[styles.sheetTall, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.text }]}>{initial ? 'Edit Data Plan' : 'New Data Plan'}</Text>
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
          <ToggleRow
            label="Enable Plan"
            sub="When disabled, purchases of this plan will be marked as failed."
            value={draft.enabled}
            onChange={(v) => set('enabled', v)}
            colors={colors}
          />
          <ToggleRow
            label="Enable Points for this Plan"
            sub="Award points on purchase and allow redeeming via points"
            value={draft.pointsEnabled}
            onChange={(v) => set('pointsEnabled', v)}
            colors={colors}
          />

          <LabeledInput label="Category" value={draft.category} onChangeText={(v) => set('category', v)} colors={colors} placeholder="Data, Minutes, Sms Bundle…" />
          <LabeledInput label="Plan name" value={draft.name} onChangeText={(v) => set('name', v)} colors={colors} placeholder="e.g. 1GB 1hr, 250MB till midnight" />

          <ToggleRow
            label="Time-configured offer"
            sub="This offer's USSD path changes depending on time of day (e.g. Safaricom menu shifts at night). Set two USSD codes with their own time windows instead of one fixed code."
            value={draft.timeConfigured}
            onChange={(v) => set('timeConfigured', v)}
            colors={colors}
          />

          {!draft.timeConfigured ? (
            <LabeledInput
              label="USSD"
              value={draft.ussd}
              onChangeText={(v) => set('ussd', v)}
              colors={colors}
              placeholder="Use pn as placeholder for customer number, e.g. *544*1*pn#"
            />
          ) : (
            <View style={{ gap: 10 }}>
              {draft.ussdVariants.map((v) => {
                const isActiveNow = variantActiveAt(v);
                return (
                <View key={v.id} style={[styles.variantCard, { borderColor: isActiveNow ? colors.tint : colors.border }]}>
                  <View style={styles.rowBetween}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{v.label}</Text>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: isActiveNow ? withAlpha(colors.tint, 0.15) : withAlpha(colors.muted, 0.15) },
                        ]}>
                        <Text style={{ color: isActiveNow ? colors.tint : colors.muted, fontSize: 10, fontWeight: '700' }}>
                          {isActiveNow ? '● Active now' : 'Not active now'}
                        </Text>
                      </View>
                    </View>
                    <Pressable onPress={() => removeVariant(v.id)} hitSlop={8}>
                      <Text style={{ color: colors.error, fontSize: 12 }}>Remove</Text>
                    </Pressable>
                  </View>
                  <LabeledInput
                    label="USSD"
                    value={v.ussd}
                    onChangeText={(t) => updateVariant(v.id, { ussd: t })}
                    colors={colors}
                    placeholder="Use pn as placeholder, e.g. *456*1*12*3*1*pn*1*1#"
                  />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TimeField
                      label="Start"
                      hour={v.startHour}
                      minute={v.startMinute}
                      onChange={(h, m) => updateVariant(v.id, { startHour: h, startMinute: m })}
                      colors={colors}
                    />
                    <TimeField
                      label="End"
                      hour={v.endHour}
                      minute={v.endMinute}
                      onChange={(h, m) => updateVariant(v.id, { endHour: h, endMinute: m })}
                      colors={colors}
                    />
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>
                    {isActiveNow
                      ? 'This window is currently active — a purchase right now would use this USSD code.'
                      : 'This window is configured but not active right now — a purchase right now would use the other window (if active) or fail if neither is.'}
                  </Text>
                </View>
                );
              })}
              {draft.ussdVariants.length < 2 && (
                <Pressable onPress={addVariant} style={[styles.btnOutline, { borderColor: colors.tint }]}>
                  <Text style={{ color: colors.tint, fontWeight: '700' }}>
                    + Add {draft.ussdVariants.length === 0 ? 'day' : 'night'} USSD window
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <LabeledInput
                label="Selling Price (KES)"
                value={String(draft.sellingPrice)}
                onChangeText={(v) => set('sellingPrice', Number(v.replace(/[^0-9.]/g, '')) || 0)}
                colors={colors}
                keyboardType="numeric"
                sub="Your price to customers"
              />
            </View>
            <View style={{ flex: 1 }}>
              <LabeledInput
                label="Safaricom Price (KES)"
                value={String(draft.safaricomPrice)}
                onChangeText={(v) => set('safaricomPrice', Number(v.replace(/[^0-9.]/g, '')) || 0)}
                colors={colors}
                keyboardType="numeric"
                sub="Reference network price"
              />
            </View>
          </View>

          <PickerRow label="Payment Mode" sub="Where user should receive payment" value={draft.paymentMode} options={PAYMENT_MODES} onChange={(v) => set('paymentMode', v as PaymentMode)} colors={colors} />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <PickerRow label="Execute SIM" sub="SIM used to run USSD" value={draft.executeSim} options={SIM_CHOICES} onChange={(v) => set('executeSim', v as SimChoice)} colors={colors} />
            </View>
            <View style={{ flex: 1 }}>
              <PickerRow label="Notification SIM" sub="SIM to send notifications" value={draft.notificationSim} options={SIM_CHOICES} onChange={(v) => set('notificationSim', v as SimChoice)} colors={colors} />
            </View>
          </View>

          <PickerRow label="USSD Type" sub="Simple, Advanced or Normal" value={draft.ussdType} options={USSD_TYPES} onChange={(v) => set('ussdType', v as UssdType)} colors={colors} />

          <ToggleRow
            label="Auto Retry"
            sub="Retry failed or pending transactions automatically"
            value={draft.autoRetry}
            onChange={(v) => set('autoRetry', v)}
            colors={colors}
          />
          {draft.autoRetry && (
            <>
              <LabeledInput
                label="Retry Count"
                value={String(draft.retryCount)}
                onChangeText={(v) => set('retryCount', Number(v.replace(/[^0-9]/g, '')) || 0)}
                colors={colors}
                keyboardType="numeric"
                sub="Number of retry attempts"
              />
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <CheckRow label="Retry Pending" value={draft.retryOnPending} onChange={(v) => set('retryOnPending', v)} colors={colors} />
                <CheckRow label="Retry Failed" value={draft.retryOnFailed} onChange={(v) => set('retryOnFailed', v)} colors={colors} />
              </View>
            </>
          )}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <Pressable onPress={onCancel} style={[styles.btnOutline, { borderColor: colors.border, flex: 1 }]}>
            <Text style={{ color: colors.text }}>Cancel</Text>
          </Pressable>
          <Pressable
            disabled={!canSave}
            onPress={() => onSave(draft)}
            style={[styles.btnSolid, { backgroundColor: canSave ? colors.tint : colors.muted, flex: 1 }]}>
            <Text style={{ color: colors.onTint, fontWeight: '700' }}>Save Changes</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  sub,
  value,
  onChange,
  colors,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <View style={styles.rowBetween}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
        {sub ? <Text style={{ color: colors.muted, fontSize: 11 }}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.tint, false: colors.border }} />
    </View>
  );
}

function CheckRow({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={[
          styles.checkbox,
          { borderColor: colors.border, backgroundColor: value ? colors.tint : 'transparent' },
        ]}>
        {value && <Text style={{ color: colors.onTint, fontSize: 11 }}>✓</Text>}
      </View>
      <Text style={{ color: colors.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function LabeledInput({
  label,
  sub,
  value,
  onChangeText,
  colors,
  placeholder,
  keyboardType,
}: {
  label: string;
  sub?: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: (typeof Colors)['light'];
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
}) {
  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        style={[styles.search, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
      />
      {sub ? <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

function PickerRow({
  label,
  sub,
  value,
  options,
  onChange,
  colors,
}: {
  label: string;
  sub?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={[
                styles.chip,
                { backgroundColor: selected ? colors.tint : colors.background, borderColor: selected ? colors.tint : colors.border },
              ]}>
              <Text style={{ color: selected ? colors.onTint : colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {sub ? <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

function TimeField({
  label,
  hour,
  minute,
  onChange,
  colors,
}: {
  label: string;
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        <TextInput
          value={String(hour).padStart(2, '0')}
          onChangeText={(v) => {
            const h = Math.max(0, Math.min(23, Number(v.replace(/[^0-9]/g, '')) || 0));
            onChange(h, minute);
          }}
          keyboardType="numeric"
          maxLength={2}
          style={[styles.timeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        <Text style={{ color: colors.text }}>:</Text>
        <TextInput
          value={String(minute).padStart(2, '0')}
          onChangeText={(v) => {
            const m = Math.max(0, Math.min(59, Number(v.replace(/[^0-9]/g, '')) || 0));
            onChange(hour, m);
          }}
          keyboardType="numeric"
          maxLength={2}
          style={[styles.timeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '800' },
  chipRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, alignSelf: 'flex-start' },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  menu: {
    position: 'absolute',
    top: 30,
    right: 0,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 4,
    zIndex: 10,
    elevation: 6,
    minWidth: 110,
  },
  menuItem: { paddingHorizontal: 14, paddingVertical: 8 },
  fab: {
    position: 'absolute',
    right: 16,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 18, maxHeight: '50%' },
  sheetTall: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 18, maxHeight: '90%' },
  sheetTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  btnOutline: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnSolid: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  variantCard: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  checkbox: { width: 18, height: 18, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  timeInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, width: 44, textAlign: 'center' },
});
