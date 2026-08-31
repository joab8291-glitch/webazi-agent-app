/**
 * "My number" USSD verification — used at Login to prove the Notification
 * Number typed into the form is actually the SIM sitting in this phone,
 * not just a string that happens to match the saved account. Dials the
 * configured "check my number" USSD code on the Notification SIM and
 * reads the number back out of the popup — same dial+listen pattern
 * services/floatCheck.ts uses for balance checks.
 *
 * Unlike the balance codes in floatCheck.ts (fixed, not user-editable),
 * there's no single carrier-wide-correct "check my own number" code —
 * it varies and has changed before, so this is an agent-configurable
 * setting (USSD Settings → Login / Number Verification) rather than a
 * hardcoded guess.
 */

import UssdExecutor from '../modules/ussd-executor/src/UssdExecutorModule';
import { requestCallPermission, isDialQueueBusy } from './smsAutomation';
import { useSimStore } from '../store/useSimStore';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import { useActivityStore } from '../store/useActivityStore';

export type VerifyResult = {
  matched: boolean;
  detectedNumber: string | null;
  raw: string;
  error?: string;
};

/** Strips everything but digits, then keeps the last 9 — the part
 * that's stable across 07.../01.../254.../+254... formats for a
 * Kenyan number. */
export function last9Digits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.slice(-9);
}

/** Pulls the first phone-number-shaped run of digits out of a USSD
 * response, e.g. "Your number is 0712345678" or "Number: 254712345678".
 * Looks for a 9-12 digit run so it doesn't grab an unrelated short code
 * or KES amount. Returns null if nothing number-shaped is found. */
export function parseOwnNumberFromResponse(raw: string): string | null {
  const matches = raw.match(/\d[\d\s\-]{7,13}\d/g);
  if (!matches) return null;

  for (const m of matches) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 12) {
      return digits;
    }
  }
  return null;
}

/**
 * Dials the "my number" USSD code on the Notification SIM and compares
 * the number it reads back to `expectedNumber` (the one typed into the
 * Login form). Requires the code to already be configured in USSD
 * Settings — returns an explanatory error rather than guessing a code.
 */
export async function verifyNotificationNumber(expectedNumber: string): Promise<VerifyResult> {
  const subscriptionId = useSimStore.getState().tillSubscriptionId;

  if (subscriptionId == null) {
    return {
      matched: false,
      detectedNumber: null,
      raw: '',
      error: 'No Notification SIM set up yet — set it up from Settings first.',
    };
  }

  const settings = useAppSettingsStore.getState();
  const code = settings.myNumberUssdSafaricom;

  if (!code || !code.trim()) {
    return {
      matched: false,
      detectedNumber: null,
      raw: '',
      error: 'No "check my number" USSD code configured yet — set it in USSD Settings → Login / Number Verification.',
    };
  }

  if (isDialQueueBusy()) {
    return {
      matched: false,
      detectedNumber: null,
      raw: '',
      error: 'A delivery dial is in progress — try again in a moment.',
    };
  }

  const callOk = await requestCallPermission();
  if (!callOk) {
    return { matched: false, detectedNumber: null, raw: '', error: 'Phone call permission denied.' };
  }

  const log = useActivityStore.getState().addLog;

  const outcome = await new Promise<{ success: boolean; result: string }>((resolve) => {
    let settled = false;
    const timeoutMs = settings.ussdTimeoutMs;

    const sub = UssdExecutor.addListener('onUssdResult', (event: any) => {
      if (settled) return;
      settled = true;
      sub.remove();
      clearTimeout(timer);
      resolve({ success: Boolean(event?.success), result: String(event?.result ?? '') });
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sub.remove();
      resolve({ success: false, result: 'Timed out waiting for USSD response' });
    }, timeoutMs);

    try {
      // false — this is an identity check, not a Sambaza delivery, so
      // skip the delivery-confirmation classifier and validate manually
      // against the parsed number below.
      UssdExecutor.dialUssd(code.trim(), subscriptionId, [], false, settings.keyInputDelayMs);
    } catch (e: any) {
      if (settled) return;
      settled = true;
      sub.remove();
      clearTimeout(timer);
      resolve({ success: false, result: String(e?.message ?? e) });
    }
  });

  if (!outcome.success) {
    log('warn', `Number verification dial failed: ${outcome.result}`);
    return {
      matched: false,
      detectedNumber: null,
      raw: outcome.result,
      error: outcome.result || 'No response',
    };
  }

  const detected = parseOwnNumberFromResponse(outcome.result);
  if (!detected) {
    return {
      matched: false,
      detectedNumber: null,
      raw: outcome.result,
      error: `Couldn't find a number in the USSD response: "${outcome.result.slice(0, 80)}"`,
    };
  }

  const matched = last9Digits(detected) === last9Digits(expectedNumber);
  return { matched, detectedNumber: detected, raw: outcome.result };
}
