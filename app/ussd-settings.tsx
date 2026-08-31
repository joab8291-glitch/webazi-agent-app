import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppSettingsStore } from '@/store/useAppSettingsStore';

/**
 * Dedicated USSD Settings screen, reachable from Profile/Settings (not a
 * bottom tab) — mirrors the reference app's separate "USSD Settings"
 * screen rather than the general Settings tab's inline USSD section.
 *
 * There's no slider component installed in this project, so every
 * "slider" from the reference screenshots is reproduced as a row of
 * preset value chips (tap to select) plus the live current value —
 * same configuration surface, no new native dependency.
 */

const SIMPLE_TIMEOUT_PRESETS_SEC = [30, 45, 60, 90, 120];
const ADVANCED_TIMEOUT_PRESETS_SEC = [60, 90, 120, 180, 240];
const KEY_INPUT_DELAY_PRESETS_MS = [50, 100, 250, 500, 1000];
const TRANSACTION_DELAY_PRESETS_MS = [0, 100, 250, 500, 1000, 2000];

export default function UssdSettingsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const s = useAppSettingsStore();

  const [triggerSmsDraft, setTriggerSmsDraft] = useState(s.engagementTriggerSms);
  const [triggerTextDraft, setTriggerTextDraft] = useState(s.engagementTriggerSubstring);
  const [safaricomCodeDraft, setSafaricomCodeDraft] = useState(s.myNumberUssdSafaricom);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: c.text, fontSize: 22 }}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>USSD Settings</Text>
        <Pressable onPress={() => resetAll(s)} hitSlop={8}>
          <Text style={{ color: c.tint, fontWeight: '600' }}>Reset</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}>
        {/* Performance Settings */}
        <Section title="Performance Settings" sub="Configure request timeouts" colors={c}>
          <PresetRow
            label="Simple USSD Timeout"
            currentLabel={formatSeconds(s.simpleUssdTimeoutMs)}
            options={SIMPLE_TIMEOUT_PRESETS_SEC.map((sec) => ({ label: `${sec}s`, value: sec * 1000 }))}
            value={s.simpleUssdTimeoutMs}
            onChange={s.setSimpleUssdTimeoutMs}
            colors={c}
          />
          <PresetRow
            label="Advanced USSD Request Timeout"
            currentLabel={formatSeconds(s.advancedUssdTimeoutMs)}
            options={ADVANCED_TIMEOUT_PRESETS_SEC.map((sec) => ({ label: `${sec}s`, value: sec * 1000 }))}
            value={s.advancedUssdTimeoutMs}
            onChange={s.setAdvancedUssdTimeoutMs}
            colors={c}
          />
          <PresetRow
            label="Key Input Delay (Advanced/Normal USSD)"
            sub="Requires a native rebuild to take effect"
            currentLabel={`${s.keyInputDelayMs} ms`}
            options={KEY_INPUT_DELAY_PRESETS_MS.map((ms) => ({ label: `${ms}ms`, value: ms }))}
            value={s.keyInputDelayMs}
            onChange={s.setKeyInputDelayMs}
            colors={c}
          />
          <PresetRow
            label="Transaction Processing Delay"
            sub="Delay between transactions — simulates human-like processing"
            currentLabel={`${s.interDialDelayMs} ms`}
            options={TRANSACTION_DELAY_PRESETS_MS.map((ms) => ({ label: `${ms}ms`, value: ms }))}
            value={s.interDialDelayMs}
            onChange={s.setInterDialDelayMs}
            colors={c}
          />
          <ToggleRow
            label="Auto-close other USSD dialogs"
            sub="When enabled (recommended), ongoing USSD sessions are closed before sending a purchase to reduce failures."
            value={s.autoCloseUssdDialogs}
            onChange={s.setAutoCloseUssdDialogs}
            colors={c}
          />
        </Section>

        {/* Login / Number Verification */}
        <Section
          title="Login / Number Verification"
          sub="The USSD code dialed on the Notification SIM at login to confirm this phone's actual number matches the account (Safaricom only)"
          colors={c}>
          <Text style={[styles.label, { color: c.textSecondary }]}>Safaricom "check my number" code</Text>
          <TextInput
            value={safaricomCodeDraft}
            onChangeText={setSafaricomCodeDraft}
            onBlur={() => s.setMyNumberUssdSafaricom(safaricomCodeDraft)}
            placeholder="e.g. *100#"
            placeholderTextColor={c.muted}
            style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
          />
          <Text style={{ color: c.muted, fontSize: 11 }}>
            Pre-filled with the confirmed default (*100*4*1*1#). Change only if this stops
            reading back your number correctly.
          </Text>
        </Section>

        {/* Platform Exception Handling */}
        <Section title="Platform Exception Handling" sub="Choose what to do when a platform USSD error occurs" colors={c}>
          <ToggleRow
            label="Handle platform exception errors"
            sub="If USSD fails at the platform layer, apply a fallback action."
            value={s.platformExceptionHandlingEnabled}
            onChange={s.setPlatformExceptionHandlingEnabled}
            colors={c}
          />
          {s.platformExceptionHandlingEnabled && (
            <View style={{ gap: 8, marginTop: 4 }}>
              <RadioRow
                label="Wait 1 minute, then proceed to next transaction"
                sub="When a platform exception is encountered, transaction execution pauses for about a minute before continuing."
                selected={s.platformExceptionAction === 'wait_then_proceed'}
                onPress={() => s.setPlatformExceptionAction('wait_then_proceed')}
                colors={c}
              />
              <RadioRow
                label="Cancel background USSD"
                sub="Requires Accessibility permission enabled."
                selected={s.platformExceptionAction === 'cancel_background'}
                onPress={() => s.setPlatformExceptionAction('cancel_background')}
                colors={c}
              />
            </View>
          )}
        </Section>

        {/* Notifications */}
        <Section title="Notifications" sub="Configure alerts and feedback" colors={c}>
          <ToggleRow
            label="Failed Transaction Alerts"
            sub="Show a local notification only when a transaction fails. Includes USSD and response, with Retry and View actions."
            value={s.failedTransactionAlertsEnabled}
            onChange={s.setFailedTransactionAlertsEnabled}
            colors={c}
          />
          <ToggleRow
            label="USSD Processing Alerts"
            sub="Show a quick notification when USSD is sent (auto-dismisses after 5 seconds)"
            value={s.ussdProcessingAlertsEnabled}
            onChange={s.setUssdProcessingAlertsEnabled}
            colors={c}
          />
          <ToggleRow
            label="Haptic Feedback"
            sub="Feel vibrations for critical actions"
            value={s.hapticFeedbackEnabled}
            onChange={s.setHapticFeedbackEnabled}
            colors={c}
          />
        </Section>

        {/* User Engagement */}
        <Section
          title="User Engagement"
          sub="When a USSD response contains the trigger, send an SMS to guide the user."
          colors={c}>
          <ToggleRow
            label="Engage user if already recommended"
            sub="If enabled, customers will be sent alternatives via SMS. Configure alternatives in Fallback Plans."
            value={s.engageIfAlreadyRecommended}
            onChange={s.setEngageIfAlreadyRecommended}
            colors={c}
          />
          <ToggleRow
            label="Engage on trigger text"
            sub="If response contains your trigger, send your custom SMS to the customer."
            value={s.engageOnTriggerText}
            onChange={s.setEngageOnTriggerText}
            colors={c}
          />
          {s.engageOnTriggerText && (
            <>
              <Text style={[styles.label, { color: c.textSecondary }]}>Trigger substring (case-insensitive)</Text>
              <TextInput
                value={triggerTextDraft}
                onChangeText={setTriggerTextDraft}
                onBlur={() => s.setEngagementTriggerSubstring(triggerTextDraft)}
                placeholder="engage"
                placeholderTextColor={c.muted}
                style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
              />
              <Text style={[styles.label, { color: c.textSecondary }]}>Custom SMS for trigger</Text>
              <TextInput
                value={triggerSmsDraft}
                onChangeText={setTriggerSmsDraft}
                onBlur={() => s.setEngagementTriggerSms(triggerSmsDraft)}
                placeholder="Custom SMS for trigger"
                placeholderTextColor={c.muted}
                multiline
                style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text, minHeight: 60, textAlignVertical: 'top' }]}
              />
              <Text style={{ color: c.muted, fontSize: 11 }}>
                Info: Messages over 160 characters may be split into multiple SMS and incur extra cost.
              </Text>
            </>
          )}
        </Section>

        {/* Instant Retries */}
        <Section
          title="Instant Retries"
          sub="Configure retry conditions and limits for instant retries."
          colors={c}>
          <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17 }}>
            Manage retry conditions and limits for instant retries. Configure when and how many
            times transactions should be retried automatically.
          </Text>
          <Pressable
            onPress={() => router.push('/settings')}
            style={[styles.primaryBtn, { backgroundColor: c.tint }]}>
            <Text style={styles.primaryBtnText}>⚙ Manage Instant Retries</Text>
          </Pressable>
          <Text style={{ color: c.muted, fontSize: 10 }}>
            Opens Settings → Auto-retry, where the escalating retry backoff for the legacy delivery
            flow is configured.
          </Text>
        </Section>
      </ScrollView>
    </View>
  );
}

function resetAll(s: ReturnType<typeof useAppSettingsStore.getState>) {
  s.setSimpleUssdTimeoutMs(60000);
  s.setAdvancedUssdTimeoutMs(120000);
  s.setKeyInputDelayMs(100);
  s.setInterDialDelayMs(100);
  s.setAutoCloseUssdDialogs(true);
  s.setPlatformExceptionHandlingEnabled(true);
  s.setPlatformExceptionAction('wait_then_proceed');
  s.setFailedTransactionAlertsEnabled(true);
  s.setUssdProcessingAlertsEnabled(true);
  s.setHapticFeedbackEnabled(true);
  s.setEngageIfAlreadyRecommended(false);
  s.setEngageOnTriggerText(false);
  s.setEngagementTriggerSubstring('engage');
  s.setEngagementTriggerSms('');
  s.setMyNumberUssdSafaricom('*100*4*1*1#');
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)} seconds`;
}

function Section({
  title,
  sub,
  children,
  colors,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  colors: (typeof Colors)['light'];
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
      {sub ? <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 2 }}>{sub}</Text> : null}
      {children}
    </View>
  );
}

function PresetRow({
  label,
  sub,
  currentLabel,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  sub?: string;
  currentLabel: string;
  options: { label: string; value: number }[];
  value: number;
  onChange: (v: number) => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.rowBetween}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
        <Text style={{ color: colors.tint, fontSize: 12, fontWeight: '700' }}>Current: {currentLabel}</Text>
      </View>
      {sub ? <Text style={{ color: colors.muted, fontSize: 11 }}>{sub}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[
                styles.chip,
                { backgroundColor: selected ? colors.tint : colors.background, borderColor: selected ? colors.tint : colors.border },
              ]}>
              <Text style={{ color: selected ? colors.onTint : colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
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
    <View style={{ gap: 2 }}>
      <View style={styles.rowBetween}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13, flex: 1, paddingRight: 10 }}>{label}</Text>
        <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.tint, false: colors.border }} />
      </View>
      {sub ? <Text style={{ color: colors.muted, fontSize: 11 }}>{sub}</Text> : null}
    </View>
  );
}

function RadioRow({
  label,
  sub,
  selected,
  onPress,
  colors,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', gap: 10 }}>
      <View
        style={[
          styles.radioOuter,
          { borderColor: selected ? colors.tint : colors.border },
        ]}>
        {selected && <View style={[styles.radioInner, { backgroundColor: colors.tint }]} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
        {sub ? <Text style={{ color: colors.muted, fontSize: 11 }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  title: { fontSize: 17, fontWeight: '700' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  label: { fontSize: 12, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  primaryBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
});
