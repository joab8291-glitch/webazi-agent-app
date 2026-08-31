/**
 * Missed Messages — on app launch, scans the device's actual SMS inbox
 * (via ContentResolver, using the READ_SMS permission already granted
 * for live listening) for Till-SIM messages received since the last
 * scan. The live BroadcastReceiver only catches SMS while the process is
 * alive; if Android killed the app in the background, a payment SMS
 * could otherwise go completely unnoticed until someone thinks to check.
 *
 * Every candidate message is run through the same processSmsPayload()
 * pipeline as a live SMS — including the duplicate-receipt check — so
 * a message already handled by the live listener is safely skipped
 * here rather than double-processed.
 */

import { Platform } from 'react-native';

import SmsListener from '../modules/sms-listener/src/SmsListenerModule';

import { useSimStore } from '../store/useSimStore';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import { useActivityStore } from '../store/useActivityStore';

import { processSmsPayload } from './smsAutomation';

/** How far back to look on the very first scan (no lastInboxScanAt yet). */
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Runs the missed-messages scan. Safe to call any time (e.g. app launch,
 * or a manual "Scan now" button in Settings) — it's a no-op if the
 * feature is disabled, no Till SIM is set, or the native module hasn't
 * been rebuilt with queryInboxSince() yet.
 */
export async function scanMissedMessages(): Promise<{ scanned: number }> {
  const log = useActivityStore.getState().addLog;

  if (Platform.OS !== 'android') {
    return { scanned: 0 };
  }

  const settings = useAppSettingsStore.getState();

  if (!settings.missedMessagesScanEnabled) {
    return { scanned: 0 };
  }

  const tillSubscriptionId = useSimStore.getState().tillSubscriptionId;

  if (tillSubscriptionId == null) {
    // No Till SIM selected yet — nothing to scan against.
    return { scanned: 0 };
  }

  if (typeof SmsListener.queryInboxSince !== 'function') {
    // Native module hasn't been rebuilt with this function yet.
    return { scanned: 0 };
  }

  const since = settings.lastInboxScanAt
    ? Date.parse(settings.lastInboxScanAt)
    : Date.now() - DEFAULT_LOOKBACK_MS;

  let messages: { id: string; sender: string; body: string; subscriptionId: number; timestamp: number }[] = [];

  try {
    messages = SmsListener.queryInboxSince(since, tillSubscriptionId) ?? [];
  } catch (e: any) {
    log('warn', `Missed-messages scan failed: ${String(e?.message ?? e)}`);
    return { scanned: 0 };
  }

  if (messages.length > 0) {
    log(
      'info',
      `Missed-messages scan found ${messages.length} SMS since last check — reprocessing`
    );

    // Oldest first, so orders queue in the order the payments actually
    // happened.
    for (const message of messages) {
      processSmsPayload(
        {
          sender: message.sender,
          body: message.body,
          subscriptionId: message.subscriptionId,
          timestamp: message.timestamp,
        },
        'missed_scan'
      );
    }
  }

  useAppSettingsStore.getState().setLastInboxScanAt(new Date().toISOString());

  return { scanned: messages.length };
}
