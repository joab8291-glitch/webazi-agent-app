import { useNotificationTemplateStore, type NotificationEvent } from '@/store/useNotificationTemplateStore';
import { useSimStore } from '@/store/useSimStore';
import { useActivityStore } from '@/store/useActivityStore';
import { sendGuidingSms } from './smsSender';
import { resolveSimChoice } from './dataPlanPaymentMatcher';
import type { SimChoice } from '@/store/useDataPlanStore';

/**
 * Fires the customer-facing SMS configured in Settings → Notification
 * Templates for a given order outcome. Mirrors the reference screen:
 * a plan-specific template (if one exists and is enabled for this
 * event) wins over the Global one; if neither exists, or the matching
 * one is disabled, nothing is sent — same as the reference's per-event
 * enable toggle.
 *
 * Sending reuses services/smsSender.ts (the same native SEND_SMS path
 * already wired for the "Engage on trigger text" setting), so it shares
 * the same "requires a native rebuild" caveat.
 */

export type NotificationData = {
  firstName?: string;
  lastName?: string;
  transactionId?: string;
  amount?: number | string;
  package?: string;
  phoneNumber?: string;
  response?: string;
  reason?: string;
  status?: string;
};

/** Splits an M-Pesa payer name ("JOAB IRUNGU NDEGO") into {firstName}/
 * {lastName} placeholder values. Exported so callers building
 * NotificationData don't have to duplicate the split. */
export function splitPayerName(payerName?: string | null): { firstName: string; lastName: string } {
  if (!payerName) return { firstName: '', lastName: '' };
  const parts = payerName.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

function fillPlaceholders(body: string, data: NotificationData): string {
  const now = new Date();
  const values: Record<string, string> = {
    firstName: data.firstName ?? '',
    lastName: data.lastName ?? '',
    transactionId: data.transactionId ?? '',
    amount: data.amount != null ? String(data.amount) : '',
    time: now.toLocaleTimeString(),
    date: now.toLocaleDateString(),
    package: data.package ?? '',
    phoneNumber: data.phoneNumber ?? '',
    // Points system isn't built yet (per-plan toggle exists but awards
    // nothing) — these always resolve empty rather than a fabricated 0.
    pointsEarned: '',
    totalPoints: '',
    response: data.response ?? '',
    reason: data.reason ?? '',
    status: data.status ?? '',
  };

  return body.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

/** Resolve which template applies: plan-specific override first, then
 * Global, both must be enabled. Returns null if nothing should send. */
function resolveTemplate(event: NotificationEvent, planId: string | null) {
  const templates = useNotificationTemplateStore.getState().templates;

  if (planId) {
    const specific = templates.find((t) => t.event === event && t.planId === planId);
    if (specific) return specific.enabled ? specific : null;
  }

  const global = templates.find((t) => t.event === event && t.planId === null);
  return global && global.enabled ? global : null;
}

export async function sendTemplateNotification(params: {
  event: NotificationEvent;
  planId: string | null;
  phone: string;
  /** Already-resolved subscriptionId (e.g. from a dial job's
   * notifySubId) — takes priority when provided. */
  notifySubId?: number | null;
  /** Falls back to resolving this SIM choice when notifySubId isn't
   * available yet (e.g. the payment never got far enough to resolve a
   * plan's SIMs, as with Unavailable Offer / System Disabled). */
  notificationSim?: SimChoice | null;
  data: NotificationData;
}) {
  const log = useActivityStore.getState().addLog;
  const template = resolveTemplate(params.event, params.planId);
  if (!template) return;

  const filled = fillPlaceholders(template.body, { ...params.data, phoneNumber: params.data.phoneNumber ?? params.phone });
  if (!filled.trim()) return;

  const sims = useSimStore.getState().availableSims;
  let subId: number | null = params.notifySubId ?? null;
  if (subId == null && params.notificationSim) {
    subId = resolveSimChoice(params.notificationSim, sims);
  }
  const finalSubId: number = subId ?? useSimStore.getState().tillSubscriptionId ?? sims[0]?.subscriptionId ?? -1;

  const outcome = await sendGuidingSms(params.phone, filled, finalSubId);
  if (outcome.ok) {
    log('success', `Notification Template (${params.event}) sent to ${params.phone}`, { phone: params.phone });
  } else {
    log('warn', `Notification Template (${params.event}) not sent to ${params.phone}: ${outcome.reason}`, {
      phone: params.phone,
    });
  }
}
