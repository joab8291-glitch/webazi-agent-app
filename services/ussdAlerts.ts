import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useAppSettingsStore } from '@/store/useAppSettingsStore';

/**
 * Wires the Notifications section of USSD Settings (Failed Transaction
 * Alerts, USSD Processing Alerts, Haptic Feedback) into real behavior.
 * All local (on-device) — same pattern as services/floatNotifications.ts.
 */

const CHANNEL_ID = 'webazi_ussd_activity';
let channelReady = false;

async function ensureChannel() {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'USSD activity',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
  channelReady = true;
}

/** Haptic Feedback toggle — fired on a plan dial's final outcome. */
export async function fireDialHaptic(kind: 'success' | 'error') {
  if (!useAppSettingsStore.getState().hapticFeedbackEnabled) return;
  try {
    await Haptics.notificationAsync(
      kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
    );
  } catch {
    // Non-fatal — haptics aren't available on every device.
  }
}

/** USSD Processing Alerts toggle — quick notice when a USSD is sent,
 * auto-dismissed after 5 seconds as the reference screen describes. */
export async function notifyUssdProcessing(summary: string) {
  if (!useAppSettingsStore.getState().ussdProcessingAlertsEnabled) return;

  try {
    await ensureChannel();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Processing USSD',
        body: summary,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null,
    });

    setTimeout(() => {
      Notifications.dismissNotificationAsync(id).catch(() => {});
    }, 5000);
  } catch {
    // Non-fatal — this is a convenience alert, not a critical path.
  }
}

/** Failed Transaction Alerts toggle — includes USSD and response text. */
export async function notifyFailedTransaction(params: { planName: string; ussd: string; result: string }) {
  if (!useAppSettingsStore.getState().failedTransactionAlertsEnabled) return;

  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${params.planName} failed`,
        body: `${params.ussd} → ${params.result}`,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch {
    // Non-fatal.
  }
}
