/**
 * Fulfillment planner.
 *
 * Primary product: Safaricom Sambaza airtime (any amount, chunked at KES 10,000).
 * USSD: *140*{amount}*{MSISDN}#
 */

import {
  buildSambazaPlan,
  describePlan,
  SAMBAZA_MAX_PER_TX,
  type SambazaPlan,
} from './sambaza';
import { normalizeToLocal } from './phone';

export type FulfillmentMode = 'sambaza' | 'data_plan';

/** Default product line for Webazi */
export const DEFAULT_MODE: FulfillmentMode = 'sambaza';

export type FulfillmentJob = {
  mode: 'sambaza';
  plan: SambazaPlan;
  summary: string;
  /** USSD codes to dial in order from the till SIM */
  dials: { ussdCode: string; amount: number; label: string }[];
};

/**
 * Turn a paid transaction (phone + amount) into one or more USSD dials.
 *
 * Examples:
 *   amount 500   → 1 dial  *140*500*2547…#
 *   amount 10000 → 1 dial  *140*10000*2547…#
 *   amount 70000 → 7 dials *140*10000*2547…#  (×7)
 *   amount 25500 → 3 dials 10000 + 10000 + 5500
 */
export function planFulfillment(phone: string, amount: number): FulfillmentJob | null {
  const plan = buildSambazaPlan(phone, amount);
  if (!plan) return null;

  return {
    mode: 'sambaza',
    plan,
    summary: describePlan(plan),
    dials: plan.chunks.map((c) => ({
      ussdCode: plan.ussdCodes[c.index - 1],
      amount: c.amount,
      label: `Sambaza ${c.index}/${c.total} · KES ${c.amount}`,
    })),
  };
}

// ---- Back-compat helpers used by older call sites ----

export type Offer = {
  amount: number;
  ussdTemplate: string;
  menuInputs: string[];
  label: string;
  simSlot?: number;
};

/** @deprecated Prefer planFulfillment — kept so old imports don't break */
export function matchOffer(amount: number): Offer | null {
  if (!Number.isFinite(amount) || amount < 1) return null;
  const chunk = Math.min(Math.round(amount), SAMBAZA_MAX_PER_TX);
  return {
    amount: chunk,
    ussdTemplate: '*140*{amount}*{phone}#',
    menuInputs: [],
    label: `Sambaza KES ${chunk}`,
  };
}

/** @deprecated Prefer planFulfillment */
export function buildUssdCode(offer: Offer, phone: string): string {
  // Local format, matching the live dial path in sambaza.ts — this
  // deprecated helper previously built a 254… string, which would have
  // dialed the wrong pattern if anything still called it.
  const p = normalizeToLocal(phone) ?? phone.replace(/\D/g, '');
  return offer.ussdTemplate
    .replace('{phone}', p)
    .replace('{amount}', String(offer.amount));
}

export { SAMBAZA_MAX_PER_TX, buildSambazaPlan, splitIntoChunks } from './sambaza';
