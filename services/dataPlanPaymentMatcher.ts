import { useDataPlanStore, type DataPlan, type PaymentMode, type SimChoice } from '@/store/useDataPlanStore';
import { useSimStore, type SimSlot } from '@/store/useSimStore';
import { buildPlanDial, type PlanDial } from './dataPlanMatcher';
import type { ParsedPayment } from './paymentSmsParser';

/**
 * Bridges a parsed payment SMS (services/paymentSmsParser.ts) to a
 * concrete Data Plan the agent has configured, and resolves everything
 * needed to actually dial: the SIM subscriptionId and the final USSD
 * string with the customer's number substituted in.
 *
 * Matching rule: an enabled plan whose sellingPrice equals the amount
 * paid AND whose paymentMode matches how the SMS arrived (Till payment
 * SMS -> "Till SIM" plans, Personal-received SMS -> "Personal SIM"
 * plans). Paybill-with-account-number payments are handled separately
 * by the existing decodePaybillSms() path in accountRef.ts, not here.
 *
 * If a time-configured plan's price matches but it's outside its
 * current USSD window, it's reported as "outside window" rather than
 * silently treated as no match, so the caller can log/notify accurately
 * instead of dropping straight to Unmatched.
 */

const SMS_SHAPE_TO_PAYMENT_MODE: Record<ParsedPayment['shape'], PaymentMode> = {
  till: 'Till SIM',
  personal: 'Personal SIM',
};

export type PlanMatchResult =
  | {
      ok: true;
      plan: DataPlan;
      dial: PlanDial & { mode: 'direct' | 'stepped' };
      executeSubscriptionId: number;
      notifySubscriptionId: number | null;
    }
  | { ok: false; reason: string; candidatePlan?: DataPlan };

/** Resolve a plan's "SIM 1" / "SIM 2" choice to an actual subscriptionId
 * from the detected SIM slots (sorted by slot index — slot 0 = SIM 1).
 * Exported so callers outside the matcher (Notification Templates) can
 * resolve a notification SIM the same way without duplicating the logic. */
export function resolveSimChoice(choice: SimChoice, sims: SimSlot[]): number | null {
  const sorted = [...sims].sort((a, b) => a.slotIndex - b.slotIndex);
  const wantIndex = choice === 'SIM 1' ? 0 : 1;
  return sorted[wantIndex]?.subscriptionId ?? null;
}

export function matchPaymentToPlan(payment: ParsedPayment, at: Date = new Date()): PlanMatchResult {
  const wantedMode = SMS_SHAPE_TO_PAYMENT_MODE[payment.shape];
  const plans = useDataPlanStore.getState().plans;

  const priceMatches = plans.filter((p) => p.paymentMode === wantedMode && p.sellingPrice === payment.amount);

  if (priceMatches.length === 0) {
    return { ok: false, reason: `No ${wantedMode} plan priced at KES ${payment.amount}` };
  }

  const enabledMatches = priceMatches.filter((p) => p.enabled);
  if (enabledMatches.length === 0) {
    return { ok: false, reason: 'Matching plan exists but is disabled', candidatePlan: priceMatches[0] };
  }

  // If more than one enabled plan shares the same price, prefer one whose
  // USSD actually resolves right now over one that's outside its window.
  let bestReason = 'No matching plan resolves a USSD right now';
  let bestCandidate: DataPlan | undefined = enabledMatches[0];

  for (const plan of enabledMatches) {
    const dial = buildPlanDial(plan, payment.phone, at);
    if ('error' in dial) {
      bestReason = dial.error;
      bestCandidate = plan;
      continue;
    }

    const sims = useSimStore.getState().availableSims;
    const executeSubscriptionId = resolveSimChoice(plan.executeSim, sims);
    if (executeSubscriptionId == null) {
      bestReason = `${plan.executeSim} not detected on this device — refresh SIMs in Settings`;
      bestCandidate = plan;
      continue;
    }

    const notifySubscriptionId = resolveSimChoice(plan.notificationSim, sims);

    return {
      ok: true,
      plan,
      dial,
      executeSubscriptionId,
      notifySubscriptionId,
    };
  }

  return { ok: false, reason: bestReason, candidatePlan: bestCandidate };
}
