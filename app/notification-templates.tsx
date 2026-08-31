import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert, Modal, Switch, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useNotificationTemplateStore,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_PLACEHOLDERS,
  LIVE_NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationTemplate,
} from '@/store/useNotificationTemplateStore';
import { useDataPlanStore } from '@/store/useDataPlanStore';
import { sendTemplateNotification } from '@/services/notificationTemplates';

export default function NotificationTemplatesScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const templates = useNotificationTemplateStore((s) => s.templates);
  const upsertTemplate = useNotificationTemplateStore((s) => s.upsertTemplate);
  const deleteTemplate = useNotificationTemplateStore((s) => s.deleteTemplate);
  const setEnabled = useNotificationTemplateStore((s) => s.setEnabled);
  const plans = useDataPlanStore((s) => s.plans);

  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const planName = (id: string | null) => (id ? plans.find((p) => p.id === id)?.name ?? 'Unknown plan' : 'Global (no plan override)');

  const handleDelete = (t: NotificationTemplate) => {
    Alert.alert('Delete template?', `${NOTIFICATION_EVENT_LABELS[t.event]} — ${planName(t.planId)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate(t.id) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: c.text, fontSize: 16 }}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Notification Templates</Text>
        <Pressable onPress={() => setCreating(true)} hitSlop={8}>
          <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>+</Text>
        </Pressable>
      </View>

      <FlatList
        data={templates}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 60 }}>No templates yet. Tap + to create one.</Text>
        }
        renderItem={({ item }) => (
          <TemplateCard
            template={item}
            planLabel={planName(item.planId)}
            colors={c}
            live={LIVE_NOTIFICATION_EVENTS.includes(item.event)}
            onPress={() => setEditing(item)}
            onToggle={(v) => setEnabled(item.id, v)}
            onDelete={() => handleDelete(item)}
          />
        )}
      />

      <Modal
        visible={creating || !!editing}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setCreating(false);
          setEditing(null);
        }}>
        <TemplateEditor
          colors={c}
          plans={plans}
          initial={editing}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={(input) => {
            upsertTemplate(input);
            setCreating(false);
            setEditing(null);
          }}
        />
      </Modal>
    </View>
  );
}

function TemplateCard({
  template,
  planLabel,
  colors,
  live,
  onPress,
  onToggle,
  onDelete,
}: {
  template: NotificationTemplate;
  planLabel: string;
  colors: (typeof Colors)['light'];
  live: boolean;
  onPress: () => void;
  onToggle: (v: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{NOTIFICATION_EVENT_LABELS[template.event]}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
            {planLabel}
            {!live ? ' · not wired to a trigger yet' : ''}
          </Text>
        </View>
        <Switch value={template.enabled} onValueChange={onToggle} />
      </View>
      <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
        {template.body || '(empty message)'}
      </Text>
      <Pressable onPress={onDelete} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: 4 }}>
        <Text style={{ color: colors.error, fontSize: 11 }}>Delete</Text>
      </Pressable>
    </Pressable>
  );
}

function TemplateEditor({
  colors,
  plans,
  initial,
  onCancel,
  onSave,
}: {
  colors: (typeof Colors)['light'];
  plans: ReturnType<typeof useDataPlanStore.getState>['plans'];
  initial: NotificationTemplate | null;
  onCancel: () => void;
  onSave: (input: { id?: string; event: NotificationEvent; planId: string | null; enabled: boolean; body: string }) => void;
}) {
  const [event, setEvent] = useState<NotificationEvent>(initial?.event ?? 'completed');
  const [planId, setPlanId] = useState<string | null>(initial?.planId ?? null);
  const [enabled, setEnabledLocal] = useState(initial?.enabled ?? true);
  const [body, setBody] = useState(initial?.body ?? '');
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');

  const planOptions = useMemo(() => [{ id: null as string | null, name: 'Global (no plan override)' }, ...plans.map((p) => ({ id: p.id, name: p.name }))], [plans]);
  const selectedPlanLabel = planOptions.find((p) => p.id === planId)?.name ?? 'Global (no plan override)';

  const insertPlaceholder = (ph: string) => setBody((b) => `${b}{${ph}}`);

  const handleSendTest = () => {
    if (!testPhone.trim()) {
      Alert.alert('Test number required', 'Enter a phone number to send the test SMS to.');
      return;
    }
    if (!body.trim()) {
      Alert.alert('Empty message', 'Write the SMS body before sending a test.');
      return;
    }
    void sendTemplateNotification({
      event,
      planId,
      phone: testPhone.trim(),
      data: {
        firstName: 'Test',
        lastName: 'Customer',
        transactionId: 'TEST123',
        amount: 0,
        package: planOptions.find((p) => p.id === planId)?.name ?? '',
        response: 'Test response',
        reason: 'Test reason',
        status: NOTIFICATION_EVENT_LABELS[event],
      },
    });
    Alert.alert('Sent', 'Test SMS queued (uses the same enable toggle and body shown here — save first if you just edited it).');
  };

  return (
    <View style={styles.modalOverlay}>
      <View style={[styles.sheetTall, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowBetween}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{initial ? 'Edit Template' : 'New Template'}</Text>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={{ color: colors.textSecondary, fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Event</Text>
          <Pressable
            onPress={() => setEventPickerOpen(true)}
            style={[styles.field, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Text style={{ color: colors.text }}>{NOTIFICATION_EVENT_LABELS[event]}</Text>
          </Pressable>

          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 12, marginBottom: 4 }}>Plan (optional, leave empty for global)</Text>
          <Pressable
            onPress={() => setPlanPickerOpen(true)}
            style={[styles.field, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Text style={{ color: colors.text }}>{selectedPlanLabel}</Text>
          </Pressable>

          <View style={[styles.rowBetween, { marginTop: 14 }]}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Enable auto-send for this event</Text>
            <Switch value={enabled} onValueChange={setEnabledLocal} />
          </View>

          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 12, marginBottom: 4 }}>SMS Body</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            placeholder="Hi {firstName}, your purchase {transactionId} is {status}."
            placeholderTextColor={colors.muted}
            style={[styles.bodyInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>Tap a placeholder below to insert at end</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {NOTIFICATION_PLACEHOLDERS.map((ph) => (
              <Pressable
                key={ph}
                onPress={() => insertPlaceholder(ph)}
                style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{`{${ph}}`}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={() => onSave({ id: initial?.id, event, planId, enabled, body })}
            style={[styles.btnSolid, { backgroundColor: colors.tint, marginTop: 16 }]}>
            <Text style={{ color: colors.onTint, fontWeight: '700' }}>Save</Text>
          </Pressable>

          <View style={{ marginTop: 14 }}>
            <TextInput
              value={testPhone}
              onChangeText={setTestPhone}
              placeholder="Test number (07/01…)"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              style={[styles.field, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 8 }]}
            />
            <Pressable onPress={handleSendTest} hitSlop={8}>
              <Text style={{ color: colors.tint, fontWeight: '600' }}>Send Test</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>

      {/* Event picker overlay */}
      <Modal visible={eventPickerOpen} transparent animationType="fade" onRequestClose={() => setEventPickerOpen(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setEventPickerOpen(false)}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView>
              {NOTIFICATION_EVENTS.map((ev) => (
                <Pressable
                  key={ev}
                  onPress={() => {
                    setEvent(ev);
                    setEventPickerOpen(false);
                  }}
                  style={[styles.pickerRow, ev === event && { backgroundColor: colors.background }]}>
                  <Text style={{ color: colors.text }}>{NOTIFICATION_EVENT_LABELS[ev]}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Plan picker overlay */}
      <Modal visible={planPickerOpen} transparent animationType="fade" onRequestClose={() => setPlanPickerOpen(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setPlanPickerOpen(false)}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView>
              {planOptions.map((p) => (
                <Pressable
                  key={p.id ?? 'global'}
                  onPress={() => {
                    setPlanId(p.id);
                    setPlanPickerOpen(false);
                  }}
                  style={[styles.pickerRow, p.id === planId && { backgroundColor: colors.background }]}>
                  <Text style={{ color: colors.text }}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '800' },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetTall: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 18, maxHeight: '92%' },
  sheetTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  bodyInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 90, textAlignVertical: 'top' },
  btnSolid: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet: { maxHeight: '60%', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1 },
  pickerRow: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.2)' },
});
