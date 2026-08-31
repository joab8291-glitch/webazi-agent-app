/**
 * App Subscription — trial + monthly/2-monthly access, paid via Sambaza
 * airtime to a fixed, hidden destination number.
 *
 * Per the agent's spec, this app has its own subscription payment path,
 * separate from the (still-placeholder) M-Pesa STK/Daraja paybill option:
 * the agent pays by Sambaza-ing airtime to a fixed default number. That
 * number must never be visible anywhere in the UI, logs, or settings —
 * it lives ONLY as the private constant below, in this file, and is
 * never exported.
 *
 * Flow: identical engine to the existing "Sambaza to Self" feature —
 * the app auto-dials Sambaza on the configured Safaricom execution SIM
 * (services/sambaza.ts + smsAutomation.ts's manualDeliver/enqueueDial),
 * using the same strict confirmation classifier that real deliveries
 * use. There is no separate "wait for an SMS" step: the USSD dial
 * response itself is the confirmation, exactly like every other
 * Sambaza delivery in this app.
 */

import { manualDeliver } from './smsAutomation';
import { useTransactionStore } from '@/store/useTransactionStore';
import { initiateStkPush, pollOrderStatus } from './darajaClient';
import { buildSubscriptionAccountRef } from './accountRef';

/**
 * PRIVATE. Fixed subscription-payment destination. Never export this —
 * any code that needs to charge a subscription should call
 * paySubscription() below, not read this value directly.
 */
const SUBSCRIPTION_SAMBAZA_NUMBER = '0729914983';

export type SubscriptionMonths = 1 | 2;

export const SUBSCRIPTION_PRICE: Record<SubscriptionMonths, number> = {
  1: 300,
  2: 600,
};

export type SubscriptionPaymentResult = { ok: true } | { ok: false; reason: string };

/**
 * Trial period: 7 days from the agent's first successful login.
 */
export function computeTrialEndDate(firstLoginAt: Date): Date {
  return new Date(firstLoginAt.getTime() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * Subscription cycle end date, per spec: a payment always extends
 * access to the 1st of the Nth month out, at the same time of day the
 * payment completed — not a rolling 30-day window. Paying for 2 months
 * reaches the 1st two calendar months out instead of one.
 *
 * This also means access naturally lapses at that exact clock moment
 * even if the phone is offline right then — everything here is a local
 * timestamp comparison, nothing depends on connectivity.
 */
export function computeSubscriptionEndDate(paidAt: Date, months: SubscriptionMonths): Date {
  const end = new Date(paidAt);
  end.setMonth(end.getMonth() + months, 1);
  end.setSeconds(paidAt.getSeconds(), paidAt.getMilliseconds());
  return end;
}

/**
 * Pay for `months` of subscription by auto-dialing Sambaza to the
 * hidden destination number, reusing the exact same delivery pipeline
 * (manualDeliver -> enqueueDial -> autoDial) as every other Sambaza
 * transaction in this app. Resolves once the dial is confirmed or
 * fails — does not resolve on "queued", only on final outcome.
 */
export function paySubscription(months: SubscriptionMonths): Promise<SubscriptionPaymentResult> {
  const amount = SUBSCRIPTION_PRICE[months];

  return new Promise((resolve) => {
    manualDeliver({ phone: SUBSCRIPTION_SAMBAZA_NUMBER, amount, network: 'safaricom' })
      .then((queued) => {
        if (!queued.ok || !queued.txnId) {
          resolve({ ok: false, reason: queued.reason ?? 'Could not queue subscription payment' });
          return;
        }

        const txnId = queued.txnId;
        let settled = false;

        const finish = (result: SubscriptionPaymentResult) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          resolve(result);
        };

        // Watch the transaction store for this specific txn to leave
        // "pending" — same store the whole app already relies on as the
        // single source of truth for delivery outcome.
        const unsubscribe = useTransactionStore.subscribe((state) => {
          const txn = state.transactions.find((t) => t.id === txnId);
          if (!txn) return;

          if (txn.status === 'completed') {
            finish({ ok: true });
          } else if (txn.status === 'failed') {
            finish({ ok: false, reason: txn.failureReason ?? 'Subscription payment failed' });
          }
        });

        // Safety net in case the transaction never resolves (shouldn't
        // happen — autoDial always calls markCompleted/markFailed — but
        // avoids leaving a caller's UI stuck spinning forever).
        setTimeout(() => finish({ ok: false, reason: 'Timed out waiting for confirmation' }), 3 * 60 * 1000);
      })
      .catch((e: any) => {
        resolve({ ok: false, reason: String(e?.message ?? e) });
      });
  });
}

/**
 * Second subscription payment method: a direct M-Pesa STK push, using
 * the exact same Daraja backend (services/darajaClient.ts) as the
 * customer-facing "Customer Payment" screen — real cash to the
 * developer's own paybill, rather than airtime forwarded via Sambaza.
 *
 * The only thing specific to a subscription payment is the
 * AccountReference: instead of the compact network+amount+phone code
 * customer orders use, this sends "SB" + the agent's own paying number
 * (services/accountRef.ts's buildSubscriptionAccountRef) so the
 * developer can tell, from the M-Pesa statement/SMS alone, which agent
 * a given subscription payment came from. That reference is never fed
 * back into the delivery pipeline — there's nothing to deliver here.
 *
 * `payingPhone` is the agent's own M-Pesa number — they get the STK PIN
 * prompt on it, same as the Customer Payment flow.
 */
export function paySubscriptionViaStk(
  months: SubscriptionMonths,
  payingPhone: string
): Promise<SubscriptionPaymentResult> {
  const amount = SUBSCRIPTION_PRICE[months];
  const accountRef = buildSubscriptionAccountRef(payingPhone);

  return (async () => {
    const pushResult = await initiateStkPush({
      phone: payingPhone,
      amount,
      accountRef,
      description: `Webazi subscription ${months} month${months === 2 ? 's' : ''}`,
    });

    if (!pushResult.ok) {
      return { ok: false, reason: pushResult.reason };
    }

    const outcome = await pollOrderStatus(pushResult.merchantRequestId);

    if (outcome.ok) {
      return { ok: true };
    }

    return { ok: false, reason: outcome.reason };
  })();
}
