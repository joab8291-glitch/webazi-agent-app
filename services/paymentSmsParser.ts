import { normalizeToLocal } from './phone';

/**
 * Parses the M-Pesa confirmation SMS shapes that don't carry an "Account
 * Number" field — i.e. anything that ISN'T a Paybill payment with a typed
 * account number. This covers:
 *
 *  1. Till / Buy Goods payment (customer pays your Till directly):
 *     "UGRO40HB7B Confirmed.on 27/7/26 at 10:00 PMKSH15.00 received from
 *      254729914912 JOAB IRUNGU NDEGO. New Account balance is KSH15.35.
 *      Transaction cost, KSH0.00."
 *
 *     Real-world messages from Safaricom sometimes drop the space before
 *     "KSH" (e.g. "10:00 PMKSH15.00") — the amount regex below doesn't
 *     require a word boundary, so this still matches. Casing of
 *     "Ksh"/"KSH" varies too and is handled case-insensitively.
 *
 *  2. Personal "you have received" payment (customer sends money to your
 *     personal M-PESA number, not a Till/Paybill):
 *     "UHOO43KO9X Confirmed. You have received Ksh20.00 from JOHN DOE
 *      254712345678 on 27/8/26 at 4:09 PM. New M-PESA balance is Ksh50.00."
 *
 * Both are for the Data Plans Manager flow: identify {phone, amount,
 * receipt}, then look up a matching Data Plan by sellingPrice + payment
 * mode (services/dataPlanPaymentMatcher.ts) rather than decoding a
 * network/ref from the SMS itself.
 */

export type ParsedPayment = {
  shape: 'till' | 'personal';
  receipt: string | null;
  amount: number;
  phone: string; // local format, e.g. 0729914912
  payerName: string | null;
};

const RECEIPT_PATTERN = /^([A-Z0-9]{8,12})\s+Confirmed/i;

/** Matches "Ksh15.00 received" / "KSH15.00 received" / "PMKSH15.00 received" —
 * no leading boundary required, since Safaricom sometimes drops the space. */
const AMOUNT_RECEIVED_PATTERN = /Ksh\s*([\d,]+(?:\.\d+)?)\s+received/i;

/** Matches "Ksh20.00 from" for the personal "you have received" shape. */
const AMOUNT_FROM_PATTERN = /Ksh\s*([\d,]+(?:\.\d+)?)\s+from/i;

const PHONE_PATTERN = /(2547\d{8}|2541\d{8}|07\d{8}|01\d{8})/;

/**
 * Till / Buy Goods: "...KSH15.00 received from 254729914912 JOAB IRUNGU
 * NDEGO. New Account balance is..." — no "Account Number" field at all,
 * which is what distinguishes it from a Paybill payment.
 */
const TILL_RECEIVED_FROM_PATTERN =
  /received\s+from\s+(2547\d{8}|2541\d{8}|07\d{8}|01\d{8})\s+([A-Z][A-Z .'-]*?)\.?\s*New\s+(?:Account|Utility)\s+balance/i;

/**
 * Personal payment: "You have received Ksh20.00 from JOHN DOE
 * 254712345678 on 27/8/26 at 4:09 PM. New M-PESA balance is..."
 */
const PERSONAL_RECEIVED_PATTERN =
  /You have received\s+Ksh\s*[\d,]+(?:\.\d+)?\s+from\s+([A-Z][A-Z .'-]*?)\s+(2547\d{8}|2541\d{8}|07\d{8}|01\d{8})/i;

function parseAmount(raw: string): number | null {
  const amount = Math.round(parseFloat(raw.replace(/,/g, '')));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function extractReceiptLocal(smsBody: string): string | null {
  const match = smsBody.trim().match(RECEIPT_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

/** Decode a Till/Buy-Goods payment SMS — no "Account Number" field present. */
export function decodeTillSms(smsBody: string): ParsedPayment | null {
  const receivedMatch = smsBody.match(TILL_RECEIVED_FROM_PATTERN);
  if (!receivedMatch) return null;

  const [, rawPhone, rawName] = receivedMatch;
  const phone = normalizeToLocal(rawPhone);
  if (!phone) return null;

  const amtMatch = smsBody.match(AMOUNT_RECEIVED_PATTERN);
  if (!amtMatch) return null;

  const amount = parseAmount(amtMatch[1]);
  if (amount == null) return null;

  return {
    shape: 'till',
    receipt: extractReceiptLocal(smsBody),
    amount,
    phone,
    payerName: rawName.trim() || null,
  };
}

/** Decode a personal "you have received" payment SMS. */
export function decodePersonalSms(smsBody: string): ParsedPayment | null {
  const match = smsBody.match(PERSONAL_RECEIVED_PATTERN);
  if (!match) return null;

  const [, rawName, rawPhone] = match;
  const phone = normalizeToLocal(rawPhone);
  if (!phone) return null;

  const amtMatch = smsBody.match(AMOUNT_FROM_PATTERN);
  if (!amtMatch) return null;

  const amount = parseAmount(amtMatch[1]);
  if (amount == null) return null;

  return {
    shape: 'personal',
    receipt: extractReceiptLocal(smsBody),
    amount,
    phone,
    payerName: rawName.trim() || null,
  };
}

/**
 * Try every no-account-number shape in order (Till, then Personal).
 * Returns null if the SMS doesn't match any of them — callers should
 * already have tried the compact-ref and Paybill-account-number shapes
 * first, since this is the fallback for the remaining two.
 */
export function decodeUnreferencedPayment(smsBody: string): ParsedPayment | null {
  return decodeTillSms(smsBody) ?? decodePersonalSms(smsBody);
}
