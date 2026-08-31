import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSimStore } from '@/store/useSimStore';
import { useWhatsAppStore } from '@/store/useWhatsAppStore';
import { useAppSettingsStore } from '@/store/useAppSettingsStore';
import { refreshSimSlots } from '@/services/smsAutomation';
import { manualDial } from '@/services/smsAutomation';
import { scanMissedMessages } from '@/services/missedMessages';
import { Link } from 'expo-router';
import UssdExecutor from '@/modules/ussd-executor/src/UssdExecutorModule';
import SmsListener from '@/modules/sms-listener/src/SmsListenerModule';
import { WHATSAPP_WEBHOOK_NOTES } from '@/services/whatsapp';
import { useActivityStore } from '@/store/useActivityStore';
import { useFloatStore } from '@/store/useFloatStore';
import { checkAllFloatBalances } from '@/services/floatCheck';
import { useAuthStore } from '@/store/useAuthStore';

export default function SettingsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const { availableSims, tillSubscriptionId, setTillSim } = useSimStore();
  const wa = useWhatsAppStore();
  const log = useActivityStore((s) => s.addLog);
  const appSettings = useAppSettingsStore();
  const floatStore = useFloatStore();
  const [checkingFloat, setCheckingFloat] = useState(false);

  const [testCode, setTestCode] = useState('*334#');
  const [a11y, setA11y] = useState<boolean | null>(null);
  const [batteryExempt, setBatteryExempt] = useState<boolean | null>(null);
  const [bootRelaunch, setBootRelaunch] = useState<boolean | null>(null);
  const [newSender, setNewSender] = useState('');
  const [scanning, setScanning] = useState(false);

  const auth = useAuthStore();
  const [accountNumberDraft, setAccountNumberDraft] = useState(auth.notificationNumber ?? '');
  const [accountPasswordDraft, setAccountPasswordDraft] = useState('');

  useFocusEffect(
    useCallback(() => {
      refreshSimSlots();
      try {
        setA11y(UssdExecutor.isAccessibilityEnabled());
      } catch {
        setA11y(false);
      }
      try {
        setBatteryExempt(
          typeof SmsListener.isIgnoringBatteryOptimizations === 'function'
            ? SmsListener.isIgnoringBatteryOptimizations()
            : null
        );
      } catch {
        setBatteryExempt(null);
      }
      try {
        setBootRelaunch(
          typeof SmsListener.isBootRelaunchEnabled === 'function'
            ? SmsListener.isBootRelaunchEnabled()
            : null
        );
      } catch {
        setBootRelaunch(null);
      }
    }, [])
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 16,
        gap: 14,
      }}>
      <Text style={[styles.title, { color: c.text }]}>Settings</Text>

      {/* Account */}
      <Section title="Account" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          Your Notification Number and password, used to log in each time the app is opened.
        </Text>
        <Text style={[styles.label, { color: c.textSecondary }]}>Notification Number</Text>
        <TextInput
          value={accountNumberDraft}
          onChangeText={setAccountNumberDraft}
          placeholder="07XXXXXXXX"
          placeholderTextColor={c.muted}
          keyboardType="phone-pad"
          style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
        />
        <Text style={[styles.label, { color: c.textSecondary }]}>New password (leave blank to keep current)</Text>
        <TextInput
          value={accountPasswordDraft}
          onChangeText={setAccountPasswordDraft}
          placeholder="New password"
          placeholderTextColor={c.muted}
          secureTextEntry
          style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
        />
        <Pressable
          onPress={() => {
            if (!accountNumberDraft.trim()) {
              Alert.alert('Notification Number required');
              return;
            }
            auth.updateCredentials(
              accountNumberDraft,
              accountPasswordDraft ? accountPasswordDraft : auth.password ?? ''
            );
            setAccountPasswordDraft('');
            Alert.alert('Saved', 'Account details updated.');
          }}
          style={[styles.primaryBtn, { backgroundColor: c.tint }]}>
          <Text style={styles.primaryBtnText}>Save account details</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert('Log out?', 'You will need your Notification Number and password to log back in.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Log out', style: 'destructive', onPress: () => auth.logout() },
            ])
          }
          style={[styles.outlineBtn, { borderColor: c.error }]}>
          <Text style={{ color: c.error, fontWeight: '600' }}>Log out</Text>
        </Pressable>
      </Section>

      {/* SIM selection */}
      <Section title="Till / fulfillment SIM" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 8 }}>
          Choose which SIM dials USSD for customers.
        </Text>
        <Pressable
          onPress={() => refreshSimSlots()}
          style={[styles.outlineBtn, { borderColor: c.border }]}>
          <Text style={{ color: c.tint, fontWeight: '600' }}>Refresh SIM list</Text>
        </Pressable>
        {availableSims.length === 0 && (
          <Text style={{ color: c.muted, fontSize: 12 }}>No SIMs detected yet</Text>
        )}
        {availableSims.map((sim) => {
          const selected = tillSubscriptionId === sim.subscriptionId;
          return (
            <Pressable
              key={sim.subscriptionId}
              onPress={() => setTillSim(sim.subscriptionId)}
              style={[
                styles.simRow,
                {
                  borderColor: selected ? c.tint : c.border,
                  backgroundColor: selected ? c.surfaceAlt : c.surface,
                },
              ]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '600' }}>
                  {sim.carrierName || sim.displayName || `SIM ${sim.slotIndex}`}
                </Text>
                <Text style={{ color: c.textSecondary, fontSize: 12 }}>
                  slot {sim.slotIndex} · sub {sim.subscriptionId}
                  {sim.number ? ` · ${sim.number}` : ''}
                </Text>
              </View>
              {selected && <Text style={{ color: c.tint, fontWeight: '700' }}>✓</Text>}
            </Pressable>
          );
        })}
      </Section>

      {/* Accessibility */}
      <Section title="Accessibility service" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          Status: {a11y == null ? '…' : a11y ? 'Enabled ✓' : 'Disabled — required for multi-step USSD'}
        </Text>
        <Pressable
          onPress={() => {
            try {
              UssdExecutor.openAccessibilitySettings();
            } catch (e: any) {
              Alert.alert('Error', String(e?.message ?? e));
            }
          }}
          style={[styles.outlineBtn, { borderColor: c.border }]}>
          <Text style={{ color: c.tint, fontWeight: '600' }}>Open accessibility settings</Text>
        </Pressable>
      </Section>

      {/* Background reliability */}
      <Section title="Background reliability" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          Status:{' '}
          {batteryExempt == null
            ? 'Unknown — needs a native rebuild'
            : batteryExempt
              ? 'Battery optimization disabled ✓'
              : 'Battery optimization is ON — Android may kill the listener in the background'}
        </Text>
        <Pressable
          onPress={() => {
            try {
              if (typeof SmsListener.requestIgnoreBatteryOptimizations === 'function') {
                SmsListener.requestIgnoreBatteryOptimizations();
              } else {
                Alert.alert('Rebuild required', 'This needs a native rebuild before it can be used.');
              }
            } catch (e: any) {
              Alert.alert('Error', String(e?.message ?? e));
            }
          }}
          style={[styles.outlineBtn, { borderColor: c.border }]}>
          <Text style={{ color: c.tint, fontWeight: '600' }}>Disable battery optimization</Text>
        </Pressable>
        <Text style={{ color: c.muted, fontSize: 11, lineHeight: 16 }}>
          The SMS listener also restarts itself if the app is swiped away from Recents. Some phone
          makers (Xiaomi/MIUI, Oppo, Vivo, Huawei) still throttle background apps even with this
          granted — you may also need to enable "Autostart" for Webazi in their own battery settings.
          No app can fully guarantee this from code.
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={{ color: c.text, fontWeight: '600' }}>Reopen app after reboot</Text>
            <Text style={{ color: c.muted, fontSize: 11, lineHeight: 16 }}>
              The listener always restarts itself on reboot. Turn this on to also bring the app's
              own screen back up automatically, ~5 seconds after the phone finishes booting.
            </Text>
          </View>
          <Switch
            value={bootRelaunch ?? false}
            onValueChange={(v) => {
              try {
                if (typeof SmsListener.setBootRelaunchEnabled === 'function') {
                  SmsListener.setBootRelaunchEnabled(v);
                  setBootRelaunch(v);
                } else {
                  Alert.alert('Rebuild required', 'This needs a native rebuild before it can be used.');
                }
              } catch (e: any) {
                Alert.alert('Error', String(e?.message ?? e));
              }
            }}
          />
        </View>
      </Section>

      {/* Manual USSD test */}
      <Section title="Manual USSD test" colors={c}>
        <TextInput
          value={testCode}
          onChangeText={setTestCode}
          placeholder="*180*5*2*2547…#"
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          style={[
            styles.input,
            { backgroundColor: c.background, borderColor: c.border, color: c.text },
          ]}
        />
        <Pressable
          onPress={async () => {
            if (tillSubscriptionId == null) {
              Alert.alert('No SIM selected', 'Pick a Till / fulfillment SIM above first.');
              return;
            }
            try {
              const result = await manualDial(testCode, tillSubscriptionId);
              log(
                result.success ? 'success' : 'error',
                `Manual dial: ${result.result || (result.success ? 'OK' : 'failed')}`
              );
              Alert.alert(result.success ? 'Success' : 'Failed', result.result || 'No response');
            } catch (e: any) {
              Alert.alert('Error', String(e?.message ?? e));
            }
          }}
          style={[styles.primaryBtn, { backgroundColor: c.tint }]}>
          <Text style={styles.primaryBtnText}>Dial now</Text>
        </Pressable>
      </Section>

      {/* Advanced USSD settings */}
      <Section title="USSD settings" colors={c}>
        <Link href="/ussd-settings" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: c.tint }]}>
            <Text style={styles.primaryBtnText}>⚙ Open full USSD Settings</Text>
          </Pressable>
        </Link>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -4 }}>
          Retry policy, Simple/Advanced timeouts, key input delay, transaction verification,
          platform exception handling, notifications, and user engagement — all in one screen.
        </Text>

        <Link href="/notification-templates" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: c.tint, marginTop: 8 }]}>
            <Text style={styles.primaryBtnText}>✉ Notification Templates</Text>
          </Pressable>
        </Link>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -4 }}>
          Customer SMS sent when an order Completes or Fails, or when a payment can't be matched
          to an enabled plan.
        </Text>

        <Link href="/blacklisted-numbers" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: c.tint, marginTop: 8 }]}>
            <Text style={styles.primaryBtnText}>🚫 Blacklisted Numbers</Text>
          </Pressable>
        </Link>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -4 }}>
          Restrict specific customer numbers from receiving Data Plan deliveries.
        </Text>

        <Link href="/sambaza-topup" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: c.tint, marginTop: 8 }]}>
            <Text style={styles.primaryBtnText}>📶 Sambaza to Self</Text>
          </Pressable>
        </Link>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -4 }}>
          Top up airtime to your own default number without waiting for a customer payment.
        </Text>

        <Link href="/subscription" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: c.tint, marginTop: 8 }]}>
            <Text style={styles.primaryBtnText}>💳 Subscription</Text>
          </Pressable>
        </Link>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -4 }}>
          Check trial/subscription status, or pay early to extend access before it lapses.
        </Text>

        <Link href="/customer-payment" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: c.tint, marginTop: 8 }]}>
            <Text style={styles.primaryBtnText}>💵 Customer Payment</Text>
          </Pressable>
        </Link>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -4 }}>
          A Bingwa agent buys airtime here at a 5% discount (pays 950, gets 1000) — the resulting
          M-Pesa SMS is decoded and delivered automatically by the existing SMS pipeline.
        </Text>

        <Link href="/client-metrics" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: c.tint, marginTop: 8 }]}>
            <Text style={styles.primaryBtnText}>📊 Client Metrics</Text>
          </Pressable>
        </Link>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -4 }}>
          See new, repeat, and at-risk clients — built automatically from every completed delivery.
        </Text>

        <Link href="/sms-relay" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: c.tint, marginTop: 8 }]}>
            <Text style={styles.primaryBtnText}>📤 SMS Relay</Text>
          </Pressable>
        </Link>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -4 }}>
          Forward matching SMS (by sender, amount, or SIM) to another number.
        </Text>

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <Text style={[styles.label, { color: c.textSecondary }]}>Verified senders</Text>
        <Text style={{ color: c.muted, fontSize: 11, marginBottom: 6 }}>
          SMS on the Till SIM is only parsed if the sender matches one of these.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {appSettings.trustedSenders.map((sender) => (
            <Pressable
              key={sender}
              onPress={() => appSettings.removeTrustedSender(sender)}
              style={[styles.senderChip, { borderColor: c.border, backgroundColor: c.background }]}>
              <Text style={{ color: c.text, fontSize: 12 }}>{sender} ✕</Text>
            </Pressable>
          ))}
          {appSettings.trustedSenders.length === 0 && (
            <Text style={{ color: c.warning, fontSize: 12 }}>
              None set — all SMS on the Till SIM will be ignored.
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={newSender}
            onChangeText={setNewSender}
            placeholder="e.g. MPESA"
            placeholderTextColor={c.muted}
            autoCapitalize="characters"
            style={[
              styles.input,
              { flex: 1, backgroundColor: c.background, borderColor: c.border, color: c.text },
            ]}
          />
          <Pressable
            onPress={() => {
              if (newSender.trim()) {
                appSettings.addTrustedSender(newSender.trim());
                setNewSender('');
              }
            }}
            style={[styles.outlineBtn, { borderColor: c.border, paddingHorizontal: 16 }]}>
            <Text style={{ color: c.tint, fontWeight: '600' }}>Add</Text>
          </Pressable>
        </View>

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <ToggleRow
          label="Auto-close other USSD dialogs"
          value={appSettings.autoCloseUssdDialogs}
          onChange={appSettings.setAutoCloseUssdDialogs}
          colors={c}
        />
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -6 }}>
          Closes a lingering USSD session before dialing. Requires a native rebuild.
        </Text>

        <ToggleRow
          label="Keep screen awake during dial"
          value={appSettings.keepScreenAwakeDuringDial}
          onChange={appSettings.setKeepScreenAwakeDuringDial}
          colors={c}
        />
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -6 }}>
          Some devices need the screen on for multi-step USSD. Requires a native rebuild.
        </Text>

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <Text style={[styles.label, { color: c.textSecondary }]}>USSD response timeout (seconds)</Text>
        <TextInput
          value={String(Math.round(appSettings.ussdTimeoutMs / 1000))}
          onChangeText={(v) => {
            const n = Number(v);
            if (Number.isFinite(n)) appSettings.setUssdTimeoutMs(n * 1000);
          }}
          keyboardType="numeric"
          style={[
            styles.input,
            { backgroundColor: c.background, borderColor: c.border, color: c.text },
          ]}
        />

        <ToggleRow
          label="Auto-retry failed deliveries"
          value={appSettings.autoRetryEnabled}
          onChange={appSettings.setAutoRetryEnabled}
          colors={c}
        />
        {appSettings.autoRetryEnabled && (
          <>
            <Text style={[styles.label, { color: c.textSecondary }]}>Retry backoff (minutes)</Text>
            <TextInput
              value={appSettings.autoRetryBackoffMs.map((ms) => Math.round(ms / 60000)).join(', ')}
              onChangeText={(v) => {
                const parsed = v
                  .split(',')
                  .map((s) => Number(s.trim()))
                  .filter((n) => Number.isFinite(n) && n > 0)
                  .map((n) => n * 60000);
                if (parsed.length > 0) appSettings.setAutoRetryBackoffMs(parsed);
              }}
              placeholder="2, 5, 15"
              placeholderTextColor={c.muted}
              keyboardType="numbers-and-punctuation"
              style={[
                styles.input,
                { backgroundColor: c.background, borderColor: c.border, color: c.text },
              ]}
            />
            <Text style={{ color: c.muted, fontSize: 11 }}>
              One retry per value, in order — {appSettings.autoRetryBackoffMs.length} automatic
              attempts per failed order, then it's left failed with a notification.
            </Text>
          </>
        )}

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <Text style={[styles.label, { color: c.textSecondary }]}>
          Transaction Processing Delay — pause between chunked dials (ms)
        </Text>
        <Text style={{ color: c.muted, fontSize: 11, marginTop: -6 }}>
          Orders over KES 10,000 dial multiple *140*10000*…# chunks back-to-back. A short pause
          avoids tripping telco rate-limiting. 0–10,000ms.
        </Text>
        <TextInput
          value={String(appSettings.interDialDelayMs)}
          onChangeText={(v) => {
            const n = Number(v);
            if (Number.isFinite(n)) appSettings.setInterDialDelayMs(n);
          }}
          keyboardType="numeric"
          style={[
            styles.input,
            { backgroundColor: c.background, borderColor: c.border, color: c.text },
          ]}
        />

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <Text style={[styles.label, { color: c.textSecondary }]}>
          Auto-delete completed/failed orders after (days, 0 = never)
        </Text>
        <TextInput
          value={appSettings.autoDeleteDays == null ? '0' : String(appSettings.autoDeleteDays)}
          onChangeText={(v) => {
            const n = Number(v);
            if (Number.isFinite(n)) appSettings.setAutoDeleteDays(n);
          }}
          keyboardType="numeric"
          style={[
            styles.input,
            { backgroundColor: c.background, borderColor: c.border, color: c.text },
          ]}
        />
        <Text style={{ color: c.muted, fontSize: 11 }}>
          Pending orders are never auto-deleted. Last run:{' '}
          {appSettings.autoDeleteLastRunAt
            ? new Date(appSettings.autoDeleteLastRunAt).toLocaleString()
            : 'Never'}
        </Text>
      </Section>

      {/* Customer Payments — Daraja backend for the customer-facing form */}
      <Section title="Customer Payments (Daraja Backend)" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          Powers the Customer Payment form above — a separate backend from the Till/fulfillment
          SIM settings, used only for STK push requests.
        </Text>
        <Text style={[styles.label, { color: c.textSecondary }]}>Backend URL</Text>
        <TextInput
          value={appSettings.darajaBackendUrl}
          onChangeText={appSettings.setDarajaBackendUrl}
          placeholder="https://your-daraja-server.onrender.com"
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
        />
        <Text style={[styles.label, { color: c.textSecondary }]}>API key</Text>
        <TextInput
          value={appSettings.darajaApiKey}
          onChangeText={appSettings.setDarajaApiKey}
          placeholder="Matches API_KEY on the backend"
          placeholderTextColor={c.muted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
        />
        <Text style={{ color: c.muted, fontSize: 11 }}>
          Sent as the x-api-key header on every request — must match the backend's own API_KEY
          environment variable.
        </Text>
      </Section>

      {/* Client to Contacts Sync */}
      <Section title="Client to Contacts Sync" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          Auto-save new/edited clients as they pay. Built from the same client records that power
          Client Metrics above.
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: c.text, fontWeight: '600' }}>Enable auto-save to contacts</Text>
          <Switch
            value={appSettings.autoSaveToContacts}
            onValueChange={appSettings.setAutoSaveToContacts}
            trackColor={{ true: c.tint }}
          />
        </View>

        {appSettings.autoSaveToContacts && (
          <>
            <Text style={[styles.label, { color: c.textSecondary }]}>Save destination</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['app', 'device'] as const).map((dest) => (
                <Pressable
                  key={dest}
                  onPress={() => appSettings.setContactsSaveDestination(dest)}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingVertical: 8,
                    alignItems: 'center',
                    borderColor: c.border,
                    backgroundColor: appSettings.contactsSaveDestination === dest ? c.tint : c.background,
                  }}>
                  <Text
                    style={{
                      color: appSettings.contactsSaveDestination === dest ? c.onTint : c.text,
                      fontSize: 12,
                      fontWeight: '600',
                    }}>
                    {dest === 'app' ? '✓ App only' : 'Device contacts'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {appSettings.contactsSaveDestination === 'device' && (
              <Text style={{ color: c.muted, fontSize: 10 }}>
                Requires expo-contacts installed (npx expo install expo-contacts) and a native
                rebuild before this actually writes to your phone's Contacts.
              </Text>
            )}

            <Text style={[styles.label, { color: c.textSecondary }]}>
              Keyword (suffix appended to saved contact names)
            </Text>
            <TextInput
              value={appSettings.contactsKeywordSuffix}
              onChangeText={appSettings.setContactsKeywordSuffix}
              placeholder="BG"
              placeholderTextColor={c.muted}
              style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
            />

            <Text style={[styles.label, { color: c.textSecondary }]}>Duplicate handling</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {(
                [
                  { key: 'skip', label: '✓ Skip if exists' },
                  { key: 'update', label: 'Update existing' },
                  { key: 'duplicate', label: 'Create duplicate' },
                ] as const
              ).map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => appSettings.setContactsDuplicateHandling(opt.key)}
                  style={{
                    borderWidth: 1,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderColor: c.border,
                    backgroundColor: appSettings.contactsDuplicateHandling === opt.key ? c.tint : c.background,
                  }}>
                  <Text
                    style={{
                      color: appSettings.contactsDuplicateHandling === opt.key ? c.onTint : c.text,
                      fontSize: 11,
                    }}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </Section>

      {/* Client Metrics thresholds */}
      <Section title="Client Metrics Settings" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          Thresholds used by the Client Metrics dashboard above to flag new vs. churning clients.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: c.textSecondary }]}>"New" within (days)</Text>
            <TextInput
              value={String(appSettings.newClientWindowDays)}
              onChangeText={(v) => appSettings.setNewClientWindowDays(Number(v.replace(/\D/g, '')) || 1)}
              keyboardType="numeric"
              style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Churn risk after (days)</Text>
            <TextInput
              value={String(appSettings.churnWindowDays)}
              onChangeText={(v) => appSettings.setChurnWindowDays(Number(v.replace(/\D/g, '')) || 1)}
              keyboardType="numeric"
              style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
            />
          </View>
        </View>
      </Section>

      {/* Missed Messages */}
      <Section title="Missed Messages" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 4 }}>
          Configure inbox scan on app launch — catches a Till-SIM payment SMS that arrived while
          the app/process was killed, so it isn't silently missed.
        </Text>

        <ToggleRow
          label="Scan inbox on launch"
          value={appSettings.missedMessagesScanEnabled}
          onChange={appSettings.setMissedMessagesScanEnabled}
          colors={c}
        />

        <Text style={{ color: c.muted, fontSize: 11 }}>
          Last scan:{' '}
          {appSettings.lastInboxScanAt
            ? new Date(appSettings.lastInboxScanAt).toLocaleString()
            : 'Never'}
        </Text>

        <Pressable
          onPress={async () => {
            setScanning(true);
            try {
              const { scanned } = await scanMissedMessages();
              log('info', `Manual inbox scan complete — ${scanned} message(s) found`);
              Alert.alert('Scan complete', `${scanned} message(s) found and reprocessed.`);
            } catch (e: any) {
              Alert.alert('Error', String(e?.message ?? e));
            } finally {
              setScanning(false);
            }
          }}
          disabled={scanning}
          style={[styles.outlineBtn, { borderColor: c.border }]}>
          <Text style={{ color: c.tint, fontWeight: '600' }}>
            {scanning ? 'Scanning…' : 'Scan now'}
          </Text>
        </Pressable>

        <Link href="/mpesa-messages" asChild>
          <Pressable style={[styles.outlineBtn, { borderColor: c.border }]}>
            <Text style={{ color: c.tint, fontWeight: '600' }}>Open MPESA Messages log</Text>
          </Pressable>
        </Link>
      </Section>

      {/* Float / airtime balance */}
      <Section title="Float Balance" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 4 }}>
          Periodically dials each network's balance-enquiry code (Safaricom *144#, Airtel *133#)
          on that execution SIM, so a low float — which makes delivery dials silently fail —
          gets caught before it causes an outage.
        </Text>

        <ToggleRow
          label="Notify me when float is low"
          value={floatStore.notificationsEnabled}
          onChange={floatStore.setNotificationsEnabled}
          colors={c}
        />

        <Text style={[styles.label, { color: c.textSecondary }]}>Check every (hours, 0 = off)</Text>
        <TextInput
          value={String(floatStore.checkIntervalHours)}
          onChangeText={(v) => {
            const n = Number(v);
            if (Number.isFinite(n)) floatStore.setCheckIntervalHours(n);
          }}
          keyboardType="numeric"
          style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
        />

        <Text style={[styles.label, { color: c.textSecondary }]}>Low-balance threshold (KES)</Text>
        <TextInput
          value={String(floatStore.lowBalanceThreshold)}
          onChangeText={(v) => {
            const n = Number(v);
            if (Number.isFinite(n)) floatStore.setLowBalanceThreshold(n);
          }}
          keyboardType="numeric"
          style={[styles.input, { backgroundColor: c.background, borderColor: c.border, color: c.text }]}
        />

        <Text style={{ color: c.muted, fontSize: 11 }}>
          Safaricom: {floatStore.safaricom.balance != null ? `KES ${floatStore.safaricom.balance}` : '—'}
          {'  ·  '}
          Airtel: {floatStore.airtel.balance != null ? `KES ${floatStore.airtel.balance}` : '—'}
        </Text>

        <Pressable
          onPress={async () => {
            setCheckingFloat(true);
            try {
              await checkAllFloatBalances();
            } finally {
              setCheckingFloat(false);
            }
          }}
          disabled={checkingFloat}
          style={[styles.outlineBtn, { borderColor: c.border }]}>
          <Text style={{ color: c.tint, fontWeight: '600' }}>
            {checkingFloat ? 'Checking…' : 'Check both now'}
          </Text>
        </Pressable>
      </Section>

      {/* Daily / weekly summary */}
      <Section title="Summary" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 4 }}>
          Shown automatically when you open the app, if a day/week has passed since the last one —
          there's no background task runner installed, so it can't be pushed while the app is closed.
        </Text>

        <ToggleRow
          label="Daily summary"
          value={appSettings.dailySummaryEnabled}
          onChange={appSettings.setDailySummaryEnabled}
          colors={c}
        />
        <ToggleRow
          label="Weekly summary"
          value={appSettings.weeklySummaryEnabled}
          onChange={appSettings.setWeeklySummaryEnabled}
          colors={c}
        />
      </Section>

      {/* USSD Scheduler */}
      <Section title="USSD Scheduler" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 8 }}>
          Schedule one-off or recurring manual deliveries. Only runs while the app is open.
        </Text>
        <Link href="/ussd-scheduler" asChild>
          <Pressable style={[styles.outlineBtn, { borderColor: c.border }]}>
            <Text style={{ color: c.tint, fontWeight: '600' }}>Open scheduler</Text>
          </Pressable>
        </Link>
      </Section>

      {/* WhatsApp */}
      <Section title="WhatsApp notifications" colors={c}>
        <Text style={{ color: c.textSecondary, fontSize: 13, marginBottom: 8 }}>
          Customer notifications are sent via your backend proxy so tokens stay server-side.
          Endpoint: POST https://webazi-digital-solutions.onrender.com/whatsapp/notify
        </Text>

        <ToggleRow
          label="Enable WhatsApp notifications"
          value={wa.enabled}
          onChange={wa.setEnabled}
          colors={c}
        />
        <ToggleRow
          label="Notify on successful delivery"
          value={wa.notifyOnComplete}
          onChange={wa.setNotifyOnComplete}
          colors={c}
        />
        <ToggleRow
          label="Notify on failure"
          value={wa.notifyOnFail}
          onChange={wa.setNotifyOnFail}
          colors={c}
        />

        <Text style={[styles.label, { color: c.textSecondary }]}>Phone Number ID</Text>
        <TextInput
          value={wa.phoneNumberId}
          onChangeText={wa.setPhoneNumberId}
          placeholder="Meta WhatsApp phone number ID"
          placeholderTextColor={c.muted}
          style={[
            styles.input,
            { backgroundColor: c.background, borderColor: c.border, color: c.text },
          ]}
        />

        <Text style={[styles.label, { color: c.textSecondary }]}>Business Account ID</Text>
        <TextInput
          value={wa.businessAccountId}
          onChangeText={wa.setBusinessAccountId}
          placeholder="WABA ID"
          placeholderTextColor={c.muted}
          style={[
            styles.input,
            { backgroundColor: c.background, borderColor: c.border, color: c.text },
          ]}
        />

        <Text style={{ color: c.muted, fontSize: 11, marginTop: 8, lineHeight: 16 }}>
          {WHATSAPP_WEBHOOK_NOTES.trim()}
        </Text>
      </Section>

      <Text style={{ color: c.muted, fontSize: 11, textAlign: 'center' }}>
        Backend · https://webazi-digital-solutions.onrender.com
      </Text>
    </ScrollView>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: (typeof Colors)['light'];
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function ToggleRow({
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
    <View style={styles.toggleRow}>
      <Text style={{ color: colors.text, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.tint, false: colors.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '800' },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  outlineBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  simRow: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { fontSize: 12, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  senderChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  divider: { height: 1, backgroundColor: 'transparent', marginVertical: 4 },
});
