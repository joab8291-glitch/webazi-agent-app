/**
 * Local (on-device) notifications for low float alerts.
 *
 * These are LOCAL notifications, not remote push — nothing is sent to a
 * server, no push token or backend involved. expo-notifications' local
 * scheduling API fires regardless of whether the app is foregrounded, as
 * long as the process is alive — which it is here even with the screen
 * off: the SMS listener's Android foreground service (SmsForegroundService)
 * already keeps the process alive in the background, which is what makes
 * this actually useful instead of just an in-app toast.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import type { NetworkKey } from '../store/useFloatStore';

const CHANNEL_ID = 'webazi_float_alerts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let channelReady = false;

export async function ensureFloatAlertChannel() {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Low float alerts',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF3B30',
  });
  channelReady = true;
}

export async function requestFloatNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** Call once at app startup so tapping the alert opens the float-balance UI. */
export function attachFloatNotificationResponseListener() {
  return Notifications.addNotificationResponseReceivedListener(() => {
    // The float-balance card and "Check both now" button live in the
    // Settings tab — there's no dedicated float screen. This used to
    // route to Data Plans Manager, which doesn't show float at all.
    router.push('/(tabs)/settings');
  });
}

export async function notifyLowFloat(
  network: NetworkKey,
  balance: number,
  threshold: number
): Promise<void> {
  await ensureFloatAlertChannel();

  const granted = await requestFloatNotificationPermission();
  if (!granted) return;

  const label = network === 'safaricom' ? 'Safaricom' : 'Airtel';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Low ${label} float`,
      body: `KES ${balance} — below your KES ${threshold} threshold. Top up the execution SIM.`,
      data: { network },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null, // fire immediately
  });
}
