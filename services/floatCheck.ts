/**
 * Float/balance check — dials the network's balance-enquiry USSD code
 * on that network's execution SIM and parses the airtime figure out of
 * the response, so a low float on the dialing SIM (which makes delivery
 * dials fail silently) gets caught before it causes an outage.
 *
 * Codes are fixed per network, not user-editable — they're a Safaricom/
 * Airtel network property, not a per-agent setting:
 *   Safaricom: *144#
 *   Airtel:    *133#
 */

import UssdExecutor from '../modules/ussd-executor/src/UssdExecutorModule';
import { requestCallPermission, isDialQueueBusy } from './smsAutomation';
import { useSimStore } from '../store/useSimStore';
import { useFloatStore } from '../store/useFloatStore';
import type { NetworkKey } from '../store/useFloatStore';
import { useActivityStore } from '../store/useActivityStore';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import { notifyLowFloat } from './floatNotifications';

export const BALANCE_USSD: Record<NetworkKey, string> = {
  safaricom: '*144#',
  airtel: '*133#',
};

/**
 * Pulls a KES figure out of a balance-enquiry USSD response. Handles the
 * two message shapes seen in practice:
 *   "Airtime Bal: 0.00KSH.Expire date:21-10-2026. Tariff:S-Hook ..."
 *   "Your balance is Ksh 0.01. Dial *141# to buy Airtime from M-PESA/..."
 * Returns null if nothing balance-shaped is found, rather than guessing.
 */
export function parseBalanceResponse(raw: string): number | null {
  const patterns = [
    /airtime\s*bal(?:ance)?\s*[:\-]?\s*(?:ksh|kes)?[.:]?\s*([\d,]+(?:\.\d+)?)/i,
    /balance\s+is\s+(?:ksh|kes)?[.:]?\s*([\d,]+(?:\.\d+)?)/i,
    /(?:ksh|kes)[.:]?\s*([\d,]+(?:\.\d+)?)/i,
  ];

  for (const re of patterns) {
    const m = raw.match(re);
    if (m) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(n)) return n;
    }
  }

  return null;
}

let checking: Partial<Record<NetworkKey, boolean>> = {};

/**
 * Check float balance for one network. Dials from that network's
 * execution SIM — the same SIM real delivery dials use, since that's
 * the float that actually matters. Skips (rather than queues behind)
 * an in-flight delivery dial: a balance check is diagnostic, not an
 * order, and shouldn't delay or interleave with real customer delivery.
 */
export async function checkFloatBalance(network: NetworkKey): Promise<void> {
  if (checking[network]) return;

  if (isDialQueueBusy()) {
    // Don't dial a diagnostic check over a live delivery — the scheduler
    // will retry this on its next 30s pass.
    return;
  }

  const log = useActivityStore.getState().addLog;
  const floatStore = useFloatStore.getState();

  const executionSubId =
    network === 'airtel'
      ? useSimStore.getState().airtelExecutionSubscriptionId
      : useSimStore.getState().safaricomExecutionSubscriptionId;

  if (executionSubId == null) {
    floatStore.recordError(network, `No ${network} execution SIM configured`);
    return;
  }

  checking[network] = true;
  floatStore.setChecking(network, true);

  try {
    const callOk = await requestCallPermission();
    if (!callOk) {
      floatStore.recordError(network, 'CALL_PHONE permission denied');
      return;
    }

    if (!UssdExecutor.isAccessibilityEnabled()) {
      floatStore.recordError(network, 'Accessibility service not enabled');
      return;
    }

    /**
     * Close any lingering USSD dialog before dialing — mirrors the same
     * safeguard autoDial() uses for delivery dials. Without this, running
     * checkAllFloatBalances() (Safaricom immediately followed by Airtel,
     * with no gap) can start the second dial while the first network's
     * dialog is still settling/dismissing, and the accessibility service
     * can pick up leftover UI from that transition as the "final" result.
     * Requires a native rebuild — safe to call even if not yet present.
     */
    const settings = useAppSettingsStore.getState();
    if (settings.autoCloseUssdDialogs && typeof UssdExecutor.closeLingeringUssdDialog === 'function') {
      try {
        UssdExecutor.closeLingeringUssdDialog();
      } catch {
        // Non-fatal — proceed with the check regardless.
      }
    }

    const outcome = await new Promise<{ success: boolean; result: string }>((resolve) => {
      let settled = false;
      const timeoutMs = useAppSettingsStore.getState().ussdTimeoutMs;

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
        // false: this is a balance query, not a Sambaza delivery — don't
        // run the response through the delivery-confirmation classifier.
        // parseBalanceResponse() below does the real validation.
        UssdExecutor.dialUssd(BALANCE_USSD[network], executionSubId, [], false);
      } catch (e: any) {
        if (settled) return;
        settled = true;
        sub.remove();
        clearTimeout(timer);
        resolve({ success: false, result: String(e?.message ?? e) });
      }
    });

    if (!outcome.success) {
      log('warn', `${network} float check failed: ${outcome.result}`);
      floatStore.recordError(network, outcome.result || 'No response');
      return;
    }

    const balance = parseBalanceResponse(outcome.result);

    if (balance == null) {
      log('warn', `${network} float check: could not parse balance from "${outcome.result}"`);
      floatStore.recordError(network, `Unparsed response: ${outcome.result.slice(0, 80)}`);
      return;
    }

    floatStore.recordReading(network, balance, outcome.result);

    const threshold = floatStore.lowBalanceThreshold;
    if (balance < threshold) {
      log(
        'error',
        `Low ${network} float: KES ${balance} (below KES ${threshold} threshold) — top up the execution SIM`
      );

      // Edge-triggered: fire once per dip, not on every check while it
      // stays low. recordReading() (called just above) already reset
      // lowAlerted[network] to false the moment balance was last seen
      // at/above threshold, so this only fires on a fresh dip.
      const { notificationsEnabled, lowAlerted } = useFloatStore.getState();
      if (notificationsEnabled && !lowAlerted[network]) {
        useFloatStore.setState((s) => ({ lowAlerted: { ...s.lowAlerted, [network]: true } }));
        notifyLowFloat(network, balance, threshold).catch((e) =>
          log('warn', `Could not send low-float notification: ${String(e?.message ?? e)}`)
        );
      }
    } else {
      log('info', `${network} float: KES ${balance}`);
    }
  } finally {
    checking[network] = false;
    useFloatStore.getState().setChecking(network, false);
  }
}

export async function checkAllFloatBalances(): Promise<void> {
  await checkFloatBalance('safaricom');

  // Small gap before the second network's dial — gives the first
  // dialog's auto-dismiss (tap + window teardown) time to fully settle
  // before the next ACTION_CALL fires, on top of the closeLingeringUssdDialog()
  // safeguard above.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  await checkFloatBalance('airtel');
}

/**
 * Called from the scheduler's 30s poll loop. Only actually dials once
 * checkIntervalHours has elapsed since the last successful/attempted
 * check for a network — cheap to call often.
 */
export async function runDueFloatChecks(): Promise<void> {
  const { checkIntervalHours, safaricom, airtel } = useFloatStore.getState();
  if (checkIntervalHours <= 0) return;

  const intervalMs = checkIntervalHours * 60 * 60 * 1000;
  const now = Date.now();

  const due = (r: { checkedAt: string | null; checking: boolean }) =>
    !r.checking && (r.checkedAt == null || now - new Date(r.checkedAt).getTime() >= intervalMs);

  if (due(safaricom)) await checkFloatBalance('safaricom');
  if (due(airtel)) await checkFloatBalance('airtel');
}
