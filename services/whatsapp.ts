/**
 * WhatsApp Business Cloud API client (mobile-side notifications).
 *
 * Production delivery of messages should go through your backend
 * (https://webazi-digital-solutions.onrender.com) so the access token
 * never lives on the device. This module:
 *   1. Posts notification requests to the backend WhatsApp proxy endpoint
 *   2. Provides deep-link helpers for customer chat
 *   3. Documents the expected webhook payload for inbound messages
 */

import { Linking } from 'react-native';
import { useWhatsAppStore } from '../store/useWhatsAppStore';
import { useActivityStore } from '../store/useActivityStore';

const BACKEND = 'https://webazi-digital-solutions.onrender.com';

export type WhatsAppNotifyPayload = {
  to: string;
  template: 'delivery_success' | 'delivery_failed' | 'order_received' | 'custom';
  planName?: string;
  reason?: string;
  body?: string;
};

/**
 * Ask the backend to send a WhatsApp template / text message.
 * Backend is expected to expose POST /whatsapp/notify
 * Body: { to, template, planName?, reason?, body? }
 */
export async function notifyWhatsApp(payload: WhatsAppNotifyPayload): Promise<boolean> {
  const { enabled, notifyOnComplete, notifyOnFail } = useWhatsAppStore.getState();
  if (!enabled) return false;

  if (payload.template === 'delivery_success' && !notifyOnComplete) return false;
  if (payload.template === 'delivery_failed' && !notifyOnFail) return false;

  const to = normalizeMsisdn(payload.to);
  if (!to) {
    useActivityStore.getState().addLog('warn', 'WhatsApp: invalid recipient');
    return false;
  }

  try {
    const res = await fetch(`${BACKEND}/whatsapp/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, to }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      useActivityStore
        .getState()
        .addLog('warn', `WhatsApp notify failed (${res.status}): ${text.slice(0, 120)}`);
      return false;
    }

    useActivityStore.getState().addLog('info', `WhatsApp notified ${to} (${payload.template})`);
    return true;
  } catch (e: any) {
    // Backend may not have /whatsapp/notify yet — soft-fail
    useActivityStore
      .getState()
      .addLog('warn', `WhatsApp endpoint unreachable: ${String(e?.message ?? e)}`);
    return false;
  }
}

/** Open native WhatsApp chat with optional prefilled text */
export async function openWhatsAppChat(phone: string, text?: string) {
  const msisdn = normalizeMsisdn(phone);
  if (!msisdn) return;
  const url = text
    ? `https://wa.me/${msisdn}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${msisdn}`;
  await Linking.openURL(url);
}

function normalizeMsisdn(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1);
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.length === 9) return '254' + digits;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

/**
 * Expected inbound webhook shape (for backend implementers):
 *
 * POST /whatsapp/webhook  (Meta Cloud API)
 * {
 *   "object": "whatsapp_business_account",
 *   "entry": [{
 *     "changes": [{
 *       "value": {
 *         "messages": [{
 *           "from": "2547XXXXXXXX",
 *           "type": "text",
 *           "text": { "body": "1" }  // menu choice / order code
 *         }]
 *       }
 *     }]
 *   }]
 * }
 *
 * Map order codes → amounts → same offer matcher → queue pending txn
 * so the existing poller / SMS path can fulfill.
 */
export const WHATSAPP_WEBHOOK_NOTES = `
Backend checklist for WhatsApp Business Cloud API:
1. Meta Developer App → WhatsApp → add phone number
2. Set webhook URL to https://webazi-digital-solutions.onrender.com/whatsapp/webhook
3. Verify token + subscribe to messages
4. Implement POST /whatsapp/notify (used by this app)
5. On inbound order message, create a pending transaction (phone + amount)
   so the mobile poller fulfills via USSD
`;
