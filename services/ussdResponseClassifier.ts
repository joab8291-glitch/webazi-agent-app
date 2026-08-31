/**
 * Stricter, generic classification for Simple/Normal Data Plan USSD
 * responses. Unlike Advanced plans — whose menu screens vary too much
 * per offer to keyword-match, so any non-blank response is accepted —
 * Simple and Normal dials are held to a real pass/fail check: the
 * carrier's own response text is scanned for common failure wording,
 * and only a response with none of it (and some content) counts as a
 * genuine success.
 *
 * This is intentionally carrier-agnostic (not the Sambaza/Airtel-only
 * classifier used by the legacy chunked-transfer flow in
 * modules/ussd-executor's Kotlin code) — it just rules out the obvious
 * failure phrases any Safaricom USSD menu tends to use.
 */

const FAILURE_KEYWORDS = [
  'failed',
  'failure',
  'error',
  'invalid',
  'insufficient',
  'declined',
  'unable',
  'unavailable',
  'not available',
  'try again',
  'sorry',
  'incorrect',
  'timeout',
  'timed out',
  'no response',
  'denied',
];

export type GenericClassification = { success: boolean; reason?: string };

export function classifyGenericUssdResponse(resultText: string): GenericClassification {
  const text = (resultText ?? '').trim();

  if (!text) {
    return { success: false, reason: 'Empty USSD response' };
  }

  const lower = text.toLowerCase();
  const matched = FAILURE_KEYWORDS.find((kw) => lower.includes(kw));

  if (matched) {
    return { success: false, reason: `Response contains "${matched}": ${text}` };
  }

  return { success: true };
}
