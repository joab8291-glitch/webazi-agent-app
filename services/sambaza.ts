/**
 * Safaricom Sambaza airtime fulfillment.
 *
 * Rule: max KES 10,000 per single Sambaza USSD transaction.
 * Larger payments are split into multiple dials, e.g.
 *   70,000 → 7 × 10,000
 *   25,500 → 2 × 10,000 + 1 × 5,500
 *
 * Official USSD pattern:
 *   *140*{amount}*{local phone}#
 * Example: *140*10000*0712345678#
 * Dialed in local format (leading 0, no 254 country code) — the till
 * SIM is already on the Kenyan network, so there's no reason to carry
 * the country code into the USSD string.
 */

import { normalizeToLocal } from './phone';

/** Safaricom hard limit per Sambaza transfer */
export const SAMBAZA_MAX_PER_TX = 10_000;

/** Minimum amount we will attempt (avoid dust dials) */
export const SAMBAZA_MIN_AMOUNT = 1;

export type SambazaChunk = {
  amount: number;
  index: number; // 1-based
  total: number; // how many chunks in this payment
};

export type SambazaPlan = {
  phone: string; // normalized local, e.g. 0712345678
  totalAmount: number;
  chunks: SambazaChunk[];
  ussdCodes: string[]; // one code per chunk, same order
};

/**
 * Split a payment amount into Sambaza-safe chunks (≤ 10,000 each).
 * Uses as many full 10,000s as possible, then a remainder chunk.
 */
export function splitIntoChunks(amount: number): SambazaChunk[] {
  const total = Math.round(Number(amount));
  if (!Number.isFinite(total) || total < SAMBAZA_MIN_AMOUNT) {
    return [];
  }

  const chunks: SambazaChunk[] = [];
  let remaining = total;

  while (remaining > 0) {
    const piece = Math.min(remaining, SAMBAZA_MAX_PER_TX);
    chunks.push({
      amount: piece,
      index: chunks.length + 1,
      total: 0, // filled below
    });
    remaining -= piece;
  }

  const n = chunks.length;
  return chunks.map((c) => ({ ...c, total: n }));
}

/** Normalize a Kenyan phone number to local format: 0XXXXXXXXX */
export function normalizePhone(raw: string): string | null {
  return normalizeToLocal(raw);
}

/** Build a single Sambaza USSD string: *140*{amount}*{local phone}# */
export function buildSambazaUssd(phoneLocal: string, amount: number): string {
  return `*140*${amount}*${phoneLocal}#`;
}

/**
 * Build full fulfillment plan for one paid transaction.
 * Returns null if phone/amount invalid.
 */
export function buildSambazaPlan(phone: string, amount: number): SambazaPlan | null {
  const phoneLocal = normalizePhone(phone);
  if (!phoneLocal) return null;

  const chunks = splitIntoChunks(amount);
  if (chunks.length === 0) return null;

  return {
    phone: phoneLocal,
    totalAmount: Math.round(Number(amount)),
    chunks,
    ussdCodes: chunks.map((c) => buildSambazaUssd(phoneLocal, c.amount)),
  };
}

/** Human-readable summary for logs / UI */
export function describePlan(plan: SambazaPlan): string {
  const parts = plan.chunks.map((c) => c.amount).join(' + ');
  return `KES ${plan.totalAmount} → ${plan.chunks.length} Sambaza run(s): ${parts} to ${plan.phone}`;
}
