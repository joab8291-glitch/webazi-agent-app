import { PermissionsAndroid, Platform } from 'react-native';
import SmsListener from '@/modules/sms-listener/src/SmsListenerModule';

/**
 * Sends a guiding SMS to a customer — currently only used by the
 * User Engagement "Engage on trigger text" setting (Settings → USSD
 * Settings), which fires when a plan's USSD response contains the
 * configured trigger substring.
 *
 * Requires a native rebuild before sendSms() exists on the module —
 * guarded with a typeof check like the other recent native additions
 * in this repo (closeLingeringUssdDialog, battery-optimization calls).
 */

export async function requestSendSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
    title: 'Send SMS Permission',
    message: 'Webazi needs permission to send guiding SMS messages to customers.',
    buttonPositive: 'Allow',
    buttonNegative: 'Deny',
  });

  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function sendGuidingSms(
  phoneNumber: string,
  message: string,
  subscriptionId: number
): Promise<{ ok: boolean; reason?: string }> {
  if (!message.trim()) {
    return { ok: false, reason: 'No message configured' };
  }

  if (typeof SmsListener.sendSms !== 'function') {
    return { ok: false, reason: 'sendSms not available — requires a native rebuild' };
  }

  const granted = await requestSendSmsPermission();
  if (!granted) {
    return { ok: false, reason: 'SEND_SMS permission denied' };
  }

  try {
    const ok = SmsListener.sendSms(phoneNumber, message, subscriptionId);
    return ok ? { ok: true } : { ok: false, reason: 'Native sendSms returned false' };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}
