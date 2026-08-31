import { useSmsRelayStore, type RelayRule } from '@/store/useSmsRelayStore';
import { sendGuidingSms } from './smsSender';

/**
 * Pulls a generic "Ksh1,234.00" / "KES 1234" style amount out of any
 * SMS body — deliberately looser than the strict M-Pesa payment parser
 * in paymentSmsParser.ts, since relay rules may want to match non-MPESA
 * SMS too (this just needs a best-effort number for the optional
 * min/max amount filter).
 */
function extractGenericAmount(body: string): number | null {
  const match = body.match(/Ksh?\.?\s?([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function ruleMatches(rule: RelayRule, event: { sender: string; body: string; subscriptionId: number }): boolean {
  if (!rule.enabled) return false;

  if (rule.senderPattern.trim()) {
    if (!event.sender.toLowerCase().includes(rule.senderPattern.trim().toLowerCase())) return false;
  }

  if (rule.sourceSubscriptionId !== 'any' && rule.sourceSubscriptionId !== event.subscriptionId) {
    return false;
  }

  if (rule.minAmount != null || rule.maxAmount != null) {
    const amount = extractGenericAmount(event.body);
    if (amount == null) return false;
    if (rule.minAmount != null && amount < rule.minAmount) return false;
    if (rule.maxAmount != null && amount > rule.maxAmount) return false;
  }

  return true;
}

/**
 * Checked at the very top of processSmsPayload(), before any
 * Till-SIM/trusted-sender gating — relay is a general-purpose tool,
 * independent of payment processing, so it can forward from any SIM
 * and any sender a rule is configured to match.
 */
export async function checkAndRelay(event: { sender: string; body: string; subscriptionId: number }) {
  const { rules, recordMatch } = useSmsRelayStore.getState();

  for (const rule of rules) {
    if (!ruleMatches(rule, event)) continue;

    const forwarded = `Fwd from ${event.sender}: ${event.body}`.slice(0, 459); // 3-SMS ceiling
    const result = await sendGuidingSms(rule.targetNumber, forwarded, event.subscriptionId);

    if (result.ok) {
      recordMatch(rule.id);
    }
    // A failed forward (e.g. native rebuild pending) is silent here by
    // design — relay is a convenience layer on top of SMS processing
    // that already continues normally regardless of this outcome.
  }
}
