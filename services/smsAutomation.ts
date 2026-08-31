/**
 * SMS → decode account ref → dial Sambaza USSD automation.
 * Uses native SmsListener + UssdExecutor modules.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import type { EventSubscription } from 'expo-modules-core';

import SmsListener from '../modules/sms-listener/src/SmsListenerModule';
import type { SmsReceivedPayload } from '../modules/sms-listener/src/SmsListener.types';

import UssdExecutor from '../modules/ussd-executor/src/UssdExecutorModule';

import { decodeAccountRef, extractAccountRef, extractReceipt, decodePaybillSms } from './accountRef';
import { checkAndRelay } from './smsRelay';
import { planFulfillment } from './offerMatcher';
import { decodeUnreferencedPayment } from './paymentSmsParser';
import { matchPaymentToPlan } from './dataPlanPaymentMatcher';
import { classifyGenericUssdResponse } from './ussdResponseClassifier';
import { fireDialHaptic, notifyUssdProcessing, notifyFailedTransaction } from './ussdAlerts';
import { sendGuidingSms } from './smsSender';
import { sendTemplateNotification, splitPayerName } from './notificationTemplates';

import { useSimStore } from '../store/useSimStore';
import { useActivityStore } from '../store/useActivityStore';
import { useTransactionStore } from '../store/useTransactionStore';
import type { DialResult, LocalTransaction } from '../store/useTransactionStore';
import { useUnmatchedStore } from '../store/useUnmatchedStore';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import { useMessageLogStore } from '../store/useMessageLogStore';
import type { MessageLogSource } from '../store/useMessageLogStore';
import { useBlacklistStore } from '../store/useBlacklistStore';
import { useRecommendationTrackerStore } from '../store/useRecommendationTrackerStore';
import { useDataPlanStore } from '../store/useDataPlanStore';

import { notifyWhatsApp } from './whatsapp';

let smsSubscription: EventSubscription | null = null;

/** Resolves after `ms` milliseconds — used for the inter-dial delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SambazaDialJob = {
  kind: 'sambaza';
  txnId: string;
  network: 'safaricom' | 'airtel';
  amount: number;
  phone: string; // local format, e.g. 0735830024
  executionSubId: number;
  dials: { ussdCode: string; amount: number; label: string }[];
  summary: string;
};

/** A single-dial job resolved against a Data Plans Manager plan — the
 * USSD, execution SIM, and success classification are whatever the plan
 * defines, not the KES-10,000 Sambaza chunking rule. 'direct' dials the
 * whole chained USSD string at once (Simple/Normal plans); 'stepped'
 * dials a short base code then feeds queued menu inputs one at a time
 * as popups appear (Advanced plans — see buildAdvancedSteps). */
type PlanDialJob = {
  kind: 'plan';
  txnId: string;
  planId: string;
  planName: string;
  amount: number;
  phone: string;
  executionSubId: number;
  notifySubId: number | null;
  summary: string;
  timeoutKind: 'simple' | 'advanced';
  strictClassification: boolean;
} & (
  | { dialMode: 'direct'; ussd: string }
  | { dialMode: 'stepped'; dialCode: string; menuInputs: string[] }
);

type DialJob = SambazaDialJob | PlanDialJob;

const dialQueue: DialJob[] = [];
let processingQueue = false;

/** True while a real delivery dial is in flight or queued — used by the
 * float-balance checker to avoid dialing over an active customer order. */
export function isDialQueueBusy(): boolean {
  return processingQueue || dialQueue.length > 0;
}

/**
 * Request SMS-related permissions.
 */
export async function requestSmsPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS,
  ]);

  return Object.values(granted).every(
    (status) => status === PermissionsAndroid.RESULTS.GRANTED
  );
}

/**
 * Request CALL_PHONE permission.
 */
export async function requestCallPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CALL_PHONE,
    {
      title: 'Phone Call Permission',
      message:
        'Webazi needs permission to dial USSD codes for airtime delivery.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    }
  );

  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Refresh the available SIM slots.
 */
export function refreshSimSlots() {
  try {
    const slots = SmsListener.getSimSlots();

    useSimStore.getState().setAvailableSims(slots ?? []);

    return slots;
  } catch (e: any) {
    useActivityStore
      .getState()
      .addLog(
        'error',
        `getSimSlots failed: ${String(e?.message ?? e)}`
      );

    return [];
  }
}

/**
 * Start listening for incoming SMS messages.
 */
export async function startSmsListening(): Promise<boolean> {
  const ok = await requestSmsPermissions();

  if (!ok) {
    useActivityStore
      .getState()
      .addLog('error', 'SMS permissions denied');

    return false;
  }

  if (smsSubscription) {
    return true;
  }

  try {
    SmsListener.startListening();

    smsSubscription = SmsListener.addListener(
      'onSmsReceived',
      handleSms
    );

    // Requires a native rebuild — guarded so this still works against an
    // older build of the sms-listener module.
    if (typeof SmsListener.startForegroundService === 'function') {
      try {
        SmsListener.startForegroundService();
      } catch (e: any) {
        useActivityStore
          .getState()
          .addLog('warn', `Could not start foreground service: ${String(e?.message ?? e)}`);
      }
    }

    useSimStore.getState().setSmsListening(true);

    useActivityStore
      .getState()
      .addLog('success', 'SMS listener active');

    return true;
  } catch (e: any) {
    useActivityStore
      .getState()
      .addLog(
        'error',
        `startListening failed: ${String(e?.message ?? e)}`
      );

    return false;
  }
}

/**
 * Stop listening for SMS messages.
 */
export function stopSmsListening() {
  try {
    if (smsSubscription) {
      smsSubscription.remove();
      smsSubscription = null;
    }

    SmsListener.stopListening();

    if (typeof SmsListener.stopForegroundService === 'function') {
      SmsListener.stopForegroundService();
    }
  } catch {
    // Ignore cleanup errors.
  }

  useSimStore.getState().setSmsListening(false);

  useActivityStore
    .getState()
    .addLog('info', 'SMS listener stopped');
}

/**
 * Handle a live incoming SMS from the native listener — thin wrapper
 * around the shared processSmsPayload().
 */
function handleSms(event: SmsReceivedPayload) {
  processSmsPayload(
    {
      sender: event.sender,
      body: event.body,
      subscriptionId: event.subscriptionId,
      timestamp: event.timestamp,
    },
    'live'
  );
}

/**
 * Core SMS → order decode pipeline. Shared by three entry points:
 *  - handleSms()          live SMS via the native BroadcastReceiver
 *  - scanMissedMessages() the on-launch inbox scan, for SMS that arrived
 *                         while the app/process was killed
 *  - rerunMessage()       manually reprocessing one entry from the
 *                         MPESA Messages log, for debugging
 *
 * Every trusted-sender, Till-SIM message is written to the raw message
 * log (useMessageLogStore) regardless of outcome, so the MPESA Messages
 * screen shows the full picture — not just the ones that failed.
 */
export function processSmsPayload(
  event: { sender: string; body: string; subscriptionId: number; timestamp: number },
  source: MessageLogSource
) {
  const log = useActivityStore.getState().addLog;

  // SMS Relay is a general-purpose tool independent of payment
  // processing below — checked first so it can match SMS from any SIM
  // or sender, regardless of Till-SIM/trusted-sender gating.
  checkAndRelay(event).catch(() => {});

  const tillSubscriptionId = useSimStore.getState().tillSubscriptionId;

  log(
    'info',
    `SMS from ${event.sender} on subscription ${event.subscriptionId}: ${event.body.slice(
      0,
      80
    )}…`
  );

  /**
   * No Till SIM has been selected.
   */
  if (tillSubscriptionId == null) {
    log(
      'warn',
      'SMS received but no Till SIM is selected. Open Settings and select the Till SIM.'
    );

    return;
  }

  /**
   * Ignore SMS messages received on another SIM. Payment SMS always
   * arrives on the Till SIM regardless of which network the order is for.
   */
  if (event.subscriptionId !== tillSubscriptionId) {
    log(
      'info',
      `Ignoring SMS from subscription ${event.subscriptionId}; Till SIM is subscription ${tillSubscriptionId}`
    );

    return;
  }

  /**
   * Verified Senders check — only parse SMS whose sender name matches one
   * of the trusted senders (default: "MPESA"). Any Till-SIM message from
   * something else — a spoofed/app-generated SMS, another app's alert —
   * is dropped here, before it ever reaches the ref parser, and is not
   * added to the message log (the log is for genuine Till-SIM traffic).
   */
  const trustedSenders = useAppSettingsStore.getState().trustedSenders;
  const senderTrusted =
    trustedSenders.length === 0 ||
    trustedSenders.some((s) => event.sender.toLowerCase().includes(s.toLowerCase()));

  if (!senderTrusted) {
    log(
      'warn',
      `Ignoring SMS from untrusted sender "${event.sender}" — add it in Settings → Verified Senders if this is legitimate`
    );

    return;
  }

  const receivedAt = new Date(event.timestamp || Date.now()).toISOString();
  const logMessage = useMessageLogStore.getState().addMessage;

  /**
   * Three SMS shapes are supported, tried in this order:
   *  1. The compact website-checkout ref ("for account S/A…") generated by
   *     buildAccountRef() on the Webazi sites — legacy Sambaza flow.
   *  2. A manual Paybill payment, where the customer types their own phone
   *     number into the Account Number field prefixed with S or A
   *     ("Account Number S0729914983") — legacy Sambaza flow.
   *  3. A Data Plans Manager payment: a Till (Buy Goods) or Personal
   *     "received" SMS with NO account-number field at all, matched by
   *     price + payment mode against a configured Data Plan.
   * Whichever matches first wins; if none does, the SMS goes to the
   * Unmatched bucket so a paid customer isn't silently lost.
   */
  const ref = extractAccountRef(event.body);
  let network: 'safaricom' | 'airtel';
  let amount: number;
  let phone: string; // local format, e.g. 0735830024
  let orderRef: string;

  const decoded = ref ? decodeAccountRef(ref) : null;

  if (decoded) {
    network = decoded.network;
    amount = decoded.amount;
    phone = decoded.phone;
    orderRef = ref!;
  } else {
    const paybill = decodePaybillSms(event.body);

    if (!paybill) {
      const handled = tryHandleDataPlanPayment(event, source, receivedAt, logMessage, log);
      if (handled) return;

      if (ref) {
        log('warn', `Found account ref "${ref}" but could not decode it — ignoring`);
      }

      useUnmatchedStore.getState().addUnmatched({
        sender: event.sender,
        subscriptionId: event.subscriptionId,
        body: event.body,
        reason: ref ? 'undecodable_ref' : 'no_ref',
        ref: ref ?? null,
      });

      logMessage({
        sender: event.sender,
        subscriptionId: event.subscriptionId,
        body: event.body,
        receivedAt,
        status: ref ? 'undecodable_ref' : 'no_ref',
        ref: ref ?? null,
        source,
      });

      return;
    }

    network = paybill.network;
    amount = paybill.amount;
    phone = paybill.phone;
    orderRef = paybill.ref;
  }

  const receipt = extractReceipt(event.body);

  /**
   * Ref-dedupe — the same M-Pesa receipt can otherwise be processed twice
   * (e.g. the live listener already queued it before the missed-messages
   * scan also finds it, or a message is manually Rerun after it already
   * succeeded). A receipt code is unique per M-Pesa transaction, so treat
   * a matching existing order as the same payment and skip re-dialing.
   */
  if (receipt) {
    const alreadyExists = useTransactionStore
      .getState()
      .transactions.some((t) => t.receipt === receipt);

    if (alreadyExists) {
      log('info', `Skipping duplicate — receipt ${receipt} already has an order`);

      logMessage({
        sender: event.sender,
        subscriptionId: event.subscriptionId,
        body: event.body,
        receivedAt,
        status: 'duplicate',
        ref: orderRef,
        source,
      });

      return;
    }
  }

  /**
   * Duplicate-payment guard rail — flags (doesn't block) an order whose
   * phone AND amount match another order placed within the last 10
   * minutes. This is separate from the receipt-based dedupe above: it
   * catches a different M-Pesa receipt for what's likely the same
   * customer typing their number twice, or a SIM-swap fraud attempt —
   * cases the receipt check can't see since the receipt differs. Legit
   * repeat customers exist, so this only flags for a human to glance at
   * on the Orders screen; it never stops delivery.
   */
  const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
  const possibleDuplicate = useTransactionStore
    .getState()
    .transactions.some(
      (t) =>
        t.phone === phone &&
        t.amount === amount &&
        Date.now() - new Date(t.createdAt).getTime() <= DUPLICATE_WINDOW_MS
    );

  if (possibleDuplicate) {
    log(
      'warn',
      `${phone} paid KES ${amount} again within 10 minutes — flagged as possible duplicate, still delivering`
    );
  }

  /**
   * Execution SIM is chosen by network, independent of the Till SIM:
   * Safaricom orders dial from the Safaricom line, Airtel orders dial
   * from the Airtel line.
   */
  const executionSubId =
    network === 'airtel'
      ? useSimStore.getState().airtelExecutionSubscriptionId
      : useSimStore.getState().safaricomExecutionSubscriptionId;

  if (executionSubId == null) {
    log(
      'error',
      `No execution SIM configured for ${network} — set it in Settings`
    );

    logMessage({
      sender: event.sender,
      subscriptionId: event.subscriptionId,
      body: event.body,
      receivedAt,
      status: 'invalid',
      ref: orderRef,
      source,
    });

    return;
  }

  const job = planFulfillment(phone, amount);

  if (!job) {
    log(
      'error',
      `Invalid phone or amount for ref ${orderRef} (phone=${phone}, amount=${amount})`
    );

    logMessage({
      sender: event.sender,
      subscriptionId: event.subscriptionId,
      body: event.body,
      receivedAt,
      status: 'invalid',
      ref: orderRef,
      source,
    });

    return;
  }

  log(
    'success',
    `Decoded ${orderRef} → ${network} KES ${amount} to ${phone}. ${job.summary}`,
    { amount, phone }
  );

  const txnId = useTransactionStore.getState().addPending({
    ref: orderRef,
    receipt,
    network,
    phone,
    amount,
    possibleDuplicate,
  });

  logMessage({
    sender: event.sender,
    subscriptionId: event.subscriptionId,
    body: event.body,
    receivedAt,
    status: 'queued',
    ref: orderRef,
    source,
  });

  enqueueDial({
    kind: 'sambaza',
    txnId,
    network,
    amount,
    phone,
    executionSubId,
    dials: job.dials,
    summary: job.summary,
  });
}

/**
 * Manually reprocess one entry from the MPESA Messages log — the
 * "Rerun" button, for debugging when something silently failed. Goes
 * through the exact same pipeline as a live SMS, including the
 * duplicate-receipt check, so re-running an already-delivered message
 * is a safe no-op.
 */
export function rerunMessage(entry: {
  sender: string;
  subscriptionId: number;
  body: string;
}) {
  processSmsPayload(
    {
      sender: entry.sender,
      body: entry.body,
      subscriptionId: entry.subscriptionId,
      timestamp: Date.now(),
    },
    'rerun'
  );
}

/**
 * Attempts to match a payment SMS with no account-number field (a Till
 * or Personal "received" payment — see services/paymentSmsParser.ts)
 * against a configured Data Plan by price + payment mode, and if found,
 * queues the delivery dial for it.
 *
 * Returns true if the SMS was handled (matched or logged as a specific
 * plan-related failure) — false only when the SMS body doesn't match
 * either payment shape at all, so the caller falls through to the
 * generic Unmatched bucket.
 */
function tryHandleDataPlanPayment(
  event: { sender: string; body: string; subscriptionId: number; timestamp: number },
  source: MessageLogSource,
  receivedAt: string,
  logMessage: ReturnType<typeof useMessageLogStore.getState>['addMessage'],
  log: ReturnType<typeof useActivityStore.getState>['addLog']
): boolean {
  const parsed = decodeUnreferencedPayment(event.body);
  if (!parsed) return false;

  const orderRef = parsed.receipt ?? `PLAN-${Date.now()}`;

  // Same receipt-based dedupe as the legacy flow — a receipt is unique
  // per M-Pesa transaction.
  if (parsed.receipt) {
    const alreadyExists = useTransactionStore
      .getState()
      .transactions.some((t) => t.receipt === parsed.receipt);

    if (alreadyExists) {
      log('info', `Skipping duplicate — receipt ${parsed.receipt} already has an order`);
      logMessage({
        sender: event.sender,
        subscriptionId: event.subscriptionId,
        body: event.body,
        receivedAt,
        status: 'duplicate',
        ref: orderRef,
        source,
      });
      return true;
    }
  }

  const match = matchPaymentToPlan(parsed, new Date(event.timestamp || Date.now()));

  if (!match.ok) {
    log(
      'warn',
      `${parsed.shape === 'till' ? 'Till' : 'Personal'} payment KES ${parsed.amount} from ${parsed.phone}: ${match.reason}`
    );

    useUnmatchedStore.getState().addUnmatched({
      sender: event.sender,
      subscriptionId: event.subscriptionId,
      body: event.body,
      reason: 'no_matching_plan',
      ref: orderRef,
    });

    logMessage({
      sender: event.sender,
      subscriptionId: event.subscriptionId,
      body: event.body,
      receivedAt,
      status: 'no_matching_plan',
      ref: orderRef,
      source,
    });

    // Notification Templates: a candidatePlan means a plan matched on
    // price/mode but couldn't be used (disabled, outside its USSD
    // window, or its SIM isn't detected) — that's "System/Plan
    // Disabled". No candidate at all means nothing was priced to match
    // — "Unavailable Offer". Best-effort, never blocks the pipeline.
    const isDisabled = !!match.candidatePlan && /disabled/i.test(match.reason);
    void sendTemplateNotification({
      event: isDisabled ? 'system_disabled' : 'unavailable_offer',
      planId: match.candidatePlan?.id ?? null,
      phone: parsed.phone,
      notificationSim: match.candidatePlan?.notificationSim ?? null,
      data: {
        ...splitPayerName(parsed.payerName),
        transactionId: orderRef,
        amount: parsed.amount,
        package: match.candidatePlan?.name,
        reason: match.reason,
        status: isDisabled ? 'Disabled' : 'Unavailable',
      },
    }).catch(() => {});

    return true;
  }

  const { plan, dial, executeSubscriptionId, notifySubscriptionId } = match;

  if (useBlacklistStore.getState().isBlacklisted(parsed.phone)) {
    log('warn', `Payment KES ${parsed.amount} from ${parsed.phone} matched "${plan.name}" but number is blacklisted`);

    logMessage({
      sender: event.sender,
      subscriptionId: event.subscriptionId,
      body: event.body,
      receivedAt,
      status: 'blacklisted',
      ref: orderRef,
      source,
    });

    void sendTemplateNotification({
      event: 'blacklisted',
      planId: plan.id,
      phone: parsed.phone,
      notifySubId: notifySubscriptionId,
      data: {
        ...splitPayerName(parsed.payerName),
        transactionId: orderRef,
        amount: parsed.amount,
        package: plan.name,
        status: 'Restricted',
      },
    }).catch(() => {});

    return true;
  }

  if (useRecommendationTrackerStore.getState().wasRecommendedToday(parsed.phone, plan.id)) {
    log(
      'warn',
      `Payment KES ${parsed.amount} from ${parsed.phone} matched "${plan.name}" but was already delivered to this number today`
    );

    logMessage({
      sender: event.sender,
      subscriptionId: event.subscriptionId,
      body: event.body,
      receivedAt,
      status: 'already_recommended',
      ref: orderRef,
      source,
    });

    void sendTemplateNotification({
      event: 'already_recommended',
      planId: plan.id,
      phone: parsed.phone,
      notifySubId: notifySubscriptionId,
      data: {
        ...splitPayerName(parsed.payerName),
        transactionId: orderRef,
        amount: parsed.amount,
        package: plan.name,
        status: 'Already recommended',
        reason: 'Already delivered to this number today',
      },
    }).catch(() => {});

    return true;
  }

  log(
    'success',
    `Matched ${parsed.shape} payment KES ${parsed.amount} from ${parsed.phone} → plan "${plan.name}"${
      dial.variantLabel ? ` (${dial.variantLabel})` : ''
    }${dial.mode === 'stepped' ? ` [advanced, ${dial.menuInputs.length} steps]` : ''}`,
    { amount: parsed.amount, phone: parsed.phone }
  );

  const txnId = useTransactionStore.getState().addPending({
    ref: orderRef,
    receipt: parsed.receipt,
    network: 'safaricom',
    phone: parsed.phone,
    amount: parsed.amount,
    planId: plan.id,
    planName: plan.name,
    payerName: parsed.payerName,
  });

  logMessage({
    sender: event.sender,
    subscriptionId: event.subscriptionId,
    body: event.body,
    receivedAt,
    status: 'queued',
    ref: orderRef,
    source,
  });

  const summary = `${plan.name} · KES ${parsed.amount} to ${parsed.phone}`;

  if (dial.mode === 'stepped') {
    enqueueDial({
      kind: 'plan',
      txnId,
      planId: plan.id,
      planName: plan.name,
      amount: parsed.amount,
      phone: parsed.phone,
      executionSubId: executeSubscriptionId,
      notifySubId: notifySubscriptionId,
      summary,
      timeoutKind: dial.timeoutKind,
      strictClassification: dial.strictClassification,
      dialMode: 'stepped',
      dialCode: dial.dialCode,
      menuInputs: dial.menuInputs,
    });
  } else {
    enqueueDial({
      kind: 'plan',
      txnId,
      planId: plan.id,
      planName: plan.name,
      amount: parsed.amount,
      phone: parsed.phone,
      executionSubId: executeSubscriptionId,
      notifySubId: notifySubscriptionId,
      summary,
      timeoutKind: dial.timeoutKind,
      strictClassification: dial.strictClassification,
      dialMode: 'direct',
      ussd: dial.ussd,
    });
  }

  return true;
}

/**
 * Add a USSD job to the queue.
 */
function enqueueDial(job: DialJob) {
  dialQueue.push(job);

  useActivityStore
    .getState()
    .addLog(
      'info',
      `${job.summary} added to USSD queue (${dialQueue.length} pending)`,
      { amount: job.amount, phone: job.phone }
    );

  void processDialQueue();
}

/**
 * Process queued USSD jobs sequentially.
 */
async function processDialQueue() {
  if (processingQueue) {
    return;
  }

  processingQueue = true;

  try {
    while (dialQueue.length > 0) {
      const job = dialQueue.shift();

      if (!job) {
        continue;
      }

      if (job.kind === 'plan') {
        await autoDialPlan(job);
      } else {
        await autoDial(job);
      }
    }
  } finally {
    processingQueue = false;
  }
}

/**
 * Dial a single Data Plan order. Unlike the Sambaza flow, this is always
 * exactly one dial (no KES-10,000 chunking) and success is classified
 * leniently — any non-blank USSD response counts, since a plan's
 * response text is whatever that specific offer's menu returns, not a
 * fixed Sambaza/Airtel confirmation string.
 */
/**
 * Settings → USSD Settings → Platform Exception Handling. Applies when
 * USSD fails at the platform layer — CALL_PHONE denied, Accessibility
 * not enabled, or an unexpected thrown error — as opposed to a normal
 * carrier response the classifier just didn't like. Two actions:
 *  - 'wait_then_proceed': pause here for ~1 minute before the caller
 *    returns, which naturally pauses processDialQueue's loop before the
 *    next job starts (it's a single sequential `await` queue).
 *  - 'cancel_background': best-effort dismiss whatever USSD dialog/
 *    accessibility request might be lingering, then proceed immediately.
 */
async function handlePlatformException(reason: string) {
  const log = useActivityStore.getState().addLog;
  const settings = useAppSettingsStore.getState();

  log('warn', `Platform exception: ${reason}`);

  if (!settings.platformExceptionHandlingEnabled) {
    return;
  }

  if (settings.platformExceptionAction === 'cancel_background') {
    try {
      if (typeof UssdExecutor.closeLingeringUssdDialog === 'function') {
        UssdExecutor.closeLingeringUssdDialog();
      }
    } catch {
      // Non-fatal — best-effort cleanup.
    }
    return;
  }

  log('info', 'Platform exception handling: waiting 1 minute before the next transaction');
  await new Promise((resolve) => setTimeout(resolve, 60000));
}

/**
 * Settings → USSD Settings → User Engagement → "Engage on trigger
 * text". If the plan's final USSD response contains the configured
 * trigger substring, send the customer the configured guiding SMS
 * instead of leaving them looking at an unclear menu response.
 */
async function maybeEngageOnTrigger(job: PlanDialJob, resultText: string, notifySubId: number | null) {
  const settings = useAppSettingsStore.getState();
  const log = useActivityStore.getState().addLog;

  if (!settings.engageOnTriggerText) return;
  if (!settings.engagementTriggerSubstring.trim()) return;

  const contains = resultText.toLowerCase().includes(settings.engagementTriggerSubstring.trim().toLowerCase());
  if (!contains) return;

  const fromSubId = notifySubId ?? job.executionSubId;
  const outcome = await sendGuidingSms(job.phone, settings.engagementTriggerSms, fromSubId);

  if (outcome.ok) {
    log('success', `Engagement SMS sent to ${job.phone} (trigger matched)`, { phone: job.phone });
  } else {
    log('warn', `Engagement SMS not sent to ${job.phone}: ${outcome.reason}`, { phone: job.phone });
  }
}

async function autoDialPlan(job: PlanDialJob) {
  const log = useActivityStore.getState().addLog;
  const txnStore = useTransactionStore.getState();
  const settings = useAppSettingsStore.getState();

  try {
    const callOk = await requestCallPermission();
    if (!callOk) {
      log('error', 'CALL_PHONE denied');
      txnStore.markFailed(job.txnId, 'CALL_PHONE permission denied');
      await handlePlatformException('CALL_PHONE permission denied');
      return;
    }

    if (!UssdExecutor.isAccessibilityEnabled()) {
      const reason = 'Accessibility service not enabled — cannot dial USSD';
      log('error', 'Enable Accessibility service for Webazi in system settings');
      UssdExecutor.openAccessibilitySettings();
      txnStore.markFailed(job.txnId, reason);
      await handlePlatformException(reason);
      return;
    }

    const dialLabel = job.dialMode === 'stepped' ? job.dialCode : job.ussd;
    const menuInputs = job.dialMode === 'stepped' ? job.menuInputs : [];
    const timeoutMs = job.timeoutKind === 'advanced' ? settings.advancedUssdTimeoutMs : settings.simpleUssdTimeoutMs;

    log(
      'info',
      `Dialing "${job.planName}" (${job.timeoutKind}${job.strictClassification ? ', strict' : ', lenient'}) on execution SIM → ${dialLabel}${
        job.dialMode === 'stepped' ? ` (${menuInputs.length} queued inputs)` : ''
      }`,
      { amount: job.amount, phone: job.phone }
    );

    await notifyUssdProcessing(job.summary);

    const outcome = await dialWithTimeout(
      dialLabel,
      job.executionSubId,
      menuInputs,
      timeoutMs,
      false,
      settings.keyInputDelayMs
    );

    // Native classification is always lenient (non-blank = provisional
    // success) for plan dials. Simple/Normal plans then get a stricter
    // JS-side pass over the response text to catch obvious carrier
    // failure wording — Advanced plans skip this and trust the
    // provisional result, since their final screens vary too much
    // per-offer to keyword-match reliably.
    let success = outcome.success;
    let resultText = outcome.result;

    if (success && job.strictClassification) {
      const strict = classifyGenericUssdResponse(outcome.result);
      success = strict.success;
      if (!success && strict.reason) {
        resultText = strict.reason;
      }
    }

    const dialResult: DialResult = {
      ussdCode: dialLabel,
      amount: job.amount,
      success,
      result: resultText,
    };

    txnStore.recordDialResult(job.txnId, dialResult);

    // "Engage on trigger text" checks the RAW carrier response (before
    // any strict-classification override), since the trigger substring
    // is meant to match the carrier's own wording, not our derived
    // pass/fail reason.
    await maybeEngageOnTrigger(job, outcome.result, job.notifySubId).catch(() => {});

    const payerName = useTransactionStore.getState().transactions.find((t) => t.id === job.txnId)?.payerName;

    if (success) {
      log('success', `${job.planName} confirmed by USSD (${resultText || 'sent'})`, {
        amount: job.amount,
        phone: job.phone,
      });
      txnStore.markCompleted(job.txnId);
      useRecommendationTrackerStore.getState().recordRecommended(job.phone, job.planId);
      await fireDialHaptic('success');

      await notifyWhatsApp({
        to: job.phone,
        template: 'delivery_success',
        planName: job.planName,
      }).catch(() => {});

      void sendTemplateNotification({
        event: 'completed',
        planId: job.planId,
        phone: job.phone,
        notifySubId: job.notifySubId,
        data: {
          ...splitPayerName(payerName),
          transactionId: job.txnId,
          amount: job.amount,
          package: job.planName,
          response: resultText,
          status: 'Completed',
        },
      }).catch(() => {});
    } else {
      const failReason = `${job.planName} failed: ${resultText}`;
      log('error', failReason);
      txnStore.markFailed(job.txnId, failReason);
      await fireDialHaptic('error');
      await notifyFailedTransaction({ planName: job.planName, ussd: dialLabel, result: resultText });

      await notifyWhatsApp({
        to: job.phone,
        template: 'delivery_failed',
        planName: job.planName,
        reason: failReason,
      }).catch(() => {});

      void sendTemplateNotification({
        event: 'failed',
        planId: job.planId,
        phone: job.phone,
        notifySubId: job.notifySubId,
        data: {
          ...splitPayerName(payerName),
          transactionId: job.txnId,
          amount: job.amount,
          package: job.planName,
          response: resultText,
          reason: failReason,
          status: 'Failed',
        },
      }).catch(() => {});

      scheduleAutoRetryPlan(job, resultText);
    }
  } catch (e: any) {
    const reason = String(e?.message ?? e);
    log('error', `autoDialPlan error: ${reason}`);
    txnStore.markFailed(job.txnId, reason);
    await handlePlatformException(reason);
    scheduleAutoRetryPlan(job, reason);
  }
}

/**
 * A carrier response with no definite pass/fail wording — a timeout or
 * a blank result — is "pending" rather than a hard "failed": the
 * network didn't clearly say no, it just didn't say anything usable.
 * Distinguishes DataPlan.retryOnPending from retryOnFailed below.
 */
function isPendingPlanResult(resultText: string): boolean {
  const text = (resultText ?? '').trim().toLowerCase();
  return text === '' || text.includes('timed out') || text.includes('timeout');
}

/**
 * Per-plan auto-retry for Data Plan dials (bugs #2/#3 from the deep
 * check: DataPlan.autoRetry/retryCount/retryOnPending/retryOnFailed were
 * fully editable in the Data Plans Manager UI but never read anywhere,
 * so turning them on silently did nothing). Mirrors scheduleAutoRetry()
 * below, but keyed off the specific plan's own settings instead of the
 * global legacy-Sambaza auto-retry toggle, and re-dials the same
 * PlanDialJob directly — nothing about a plan dial's dial-plan needs
 * rebuilding the way Sambaza's chunked amount split does.
 */
function scheduleAutoRetryPlan(job: PlanDialJob, resultText: string) {
  const plan = useDataPlanStore.getState().plans.find((p) => p.id === job.planId);
  if (!plan || !plan.autoRetry) {
    return;
  }

  const pending = isPendingPlanResult(resultText);
  if (pending && !plan.retryOnPending) {
    return;
  }
  if (!pending && !plan.retryOnFailed) {
    return;
  }

  const txn = useTransactionStore.getState().transactions.find((t) => t.id === job.txnId);
  if (!txn || txn.status !== 'failed') {
    return;
  }

  // retryCount is the number of RETRIES allowed, so total attempts
  // (original + retries) is retryCount + 1.
  if (txn.attempts > plan.retryCount) {
    useActivityStore
      .getState()
      .addLog(
        'warn',
        `${job.phone}: "${job.planName}" auto-retry attempts exhausted (${txn.attempts}/${plan.retryCount + 1}) — left failed`,
        { amount: job.amount, phone: job.phone }
      );
    return;
  }

  // Reuse the global escalating backoff schedule for timing (same
  // ladder as the legacy Sambaza flow), capped by this plan's own
  // retryCount rather than the backoff array's length — once the array
  // runs out, keep retrying at its last configured delay.
  const backoff = useAppSettingsStore.getState().autoRetryBackoffMs;
  const delayMs = backoff[Math.min(txn.attempts - 1, backoff.length - 1)] ?? 60000;

  useActivityStore
    .getState()
    .addLog(
      'info',
      `Auto-retry scheduled for "${job.planName}" → ${job.phone} in ${Math.round(delayMs / 1000)}s (attempt ${
        txn.attempts + 1
      }/${plan.retryCount + 1})`,
      { amount: job.amount, phone: job.phone }
    );

  setTimeout(() => {
    const latest = useTransactionStore.getState().transactions.find((t) => t.id === job.txnId);
    if (!latest || latest.status !== 'failed') {
      return;
    }

    useTransactionStore.getState().bumpAttempts(job.txnId);
    void autoDialPlan(job);
  }, delayMs);
}


/**
 * Automatically dial the USSD chunks for a decoded order.
 */
async function autoDial(job: SambazaDialJob) {
  const log = useActivityStore.getState().addLog;
  const txnStore = useTransactionStore.getState();
  const settings = useAppSettingsStore.getState();

  let wakeLockHeld = false;

  try {
    /**
     * Request permission to make phone calls.
     */
    const callOk = await requestCallPermission();

    if (!callOk) {
      log('error', 'CALL_PHONE denied');
      txnStore.markFailed(job.txnId, 'CALL_PHONE permission denied');
      await handlePlatformException('CALL_PHONE permission denied');
      scheduleAutoRetry(job);
      return;
    }

    /**
     * USSD automation requires the Accessibility service.
     */
    if (!UssdExecutor.isAccessibilityEnabled()) {
      const reason = 'Accessibility service not enabled — cannot dial USSD';

      log('error', `Enable Accessibility service for Webazi in system settings`);

      UssdExecutor.openAccessibilitySettings();

      txnStore.markFailed(job.txnId, reason);
      await handlePlatformException(reason);

      return;
    }

    /**
     * Keep the screen on for the duration of this (possibly multi-chunk)
     * dial. Requires a native rebuild — safe to call even on a build that
     * doesn't have it yet, since it's guarded.
     */
    if (settings.keepScreenAwakeDuringDial && typeof UssdExecutor.acquireDialWakeLock === 'function') {
      try {
        UssdExecutor.acquireDialWakeLock();
        wakeLockHeld = true;
      } catch (e: any) {
        log('warn', `Could not acquire wake lock: ${String(e?.message ?? e)}`);
      }
    }

    let allOk = true;
    let failReason = '';

    for (const [dialIndex, dial] of job.dials.entries()) {
      /**
       * Transaction Processing Delay — a deliberate pause before every
       * dial after the first. Orders over KES 10,000 get chunked into
       * multiple back-to-back *140*10000*...# dials; firing them with no
       * gap at all is likely to trip telco rate-limiting.
       */
      if (dialIndex > 0 && settings.interDialDelayMs > 0) {
        await sleep(settings.interDialDelayMs);
      }

      /**
       * Close any lingering USSD dialog before sending the next one —
       * a common cause of "no response" is a stale dialog from a
       * previous session still sitting on top. Requires a native
       * rebuild; safe to call even if not yet present.
       */
      if (settings.autoCloseUssdDialogs && typeof UssdExecutor.closeLingeringUssdDialog === 'function') {
        try {
          UssdExecutor.closeLingeringUssdDialog();
        } catch {
          // Non-fatal — proceed with the dial regardless.
        }
      }

      log(
        'info',
        `Dialing ${dial.label} on ${job.network} execution SIM → ${dial.ussdCode}`,
        { amount: dial.amount, phone: job.phone }
      );

      const outcome = await dialWithTimeout(
        dial.ussdCode,
        job.executionSubId,
        [],
        settings.ussdTimeoutMs,
        true // real delivery — must match the Sambaza/Airtel confirmation text
      );

      const dialResult: DialResult = {
        ussdCode: dial.ussdCode,
        amount: dial.amount,
        success: outcome.success,
        result: outcome.result,
      };

      txnStore.recordDialResult(job.txnId, dialResult);

      if (!outcome.success) {
        allOk = false;
        failReason = `${dial.label} failed: ${outcome.result}`;
        log('error', failReason);
        break;
      }

      log(
        'success',
        `${dial.label} confirmed by USSD (${outcome.result || 'sent'})`,
        { amount: dial.amount, phone: job.phone }
      );
    }

    if (allOk) {
      log(
        'success',
        `KES ${job.amount} delivered to ${job.phone} (${job.network})`,
        { amount: job.amount, phone: job.phone }
      );

      txnStore.markCompleted(job.txnId);

      await notifyWhatsApp({
        to: job.phone,
        template: 'delivery_success',
        planName: `${job.network} airtime KES ${job.amount}`,
      }).catch(() => {});
    } else {
      log(
        'error',
        `Delivery failed for ${job.phone} (${job.network} KES ${job.amount}): ${failReason}`,
        { amount: job.amount, phone: job.phone }
      );

      txnStore.markFailed(job.txnId, failReason);

      await notifyWhatsApp({
        to: job.phone,
        template: 'delivery_failed',
        planName: `${job.network} airtime KES ${job.amount}`,
        reason: failReason,
      }).catch(() => {});

      scheduleAutoRetry(job);
    }
  } catch (e: any) {
    const reason = String(e?.message ?? e);

    log('error', `autoDial error: ${reason}`);

    txnStore.markFailed(job.txnId, reason);
    await handlePlatformException(reason);

    scheduleAutoRetry(job);
  } finally {
    if (wakeLockHeld && typeof UssdExecutor.releaseDialWakeLock === 'function') {
      try {
        UssdExecutor.releaseDialWakeLock();
      } catch {
        // Non-fatal.
      }
    }
  }
}

/**
 * If auto-retry is enabled in Settings, schedule another attempt for a
 * failed order using the configured backoff — attempt 2 fires after
 * backoffMs[0], attempt 3 after backoffMs[1], and so on. Once attempts
 * exceed the backoff array length, the order is left failed (and
 * already notified via WhatsApp/Activity log) instead of retrying
 * forever. Re-checks the transaction at fire time in case it was
 * deleted, manually requeued, or resolved in the meantime.
 */
function scheduleAutoRetry(job: SambazaDialJob) {
  const settings = useAppSettingsStore.getState();

  if (!settings.autoRetryEnabled) {
    return;
  }

  const txn = useTransactionStore.getState().transactions.find((t) => t.id === job.txnId);
  const backoff = settings.autoRetryBackoffMs;

  // attempts=1 is the original dial; attempts=2 is the first retry, so
  // backoff[attempts - 1] is the delay before the *next* attempt.
  if (!txn || txn.status !== 'failed' || txn.attempts > backoff.length) {
    return;
  }

  const delayMs = backoff[txn.attempts - 1];
  if (delayMs == null) {
    useActivityStore
      .getState()
      .addLog(
        'warn',
        `${job.phone}: auto-retry attempts exhausted (${txn.attempts}/${backoff.length}) — left failed`,
        { amount: job.amount, phone: job.phone }
      );
    return;
  }

  useActivityStore
    .getState()
    .addLog(
      'info',
      `Auto-retry scheduled for ${job.phone} in ${Math.round(delayMs / 1000)}s (attempt ${
        txn.attempts + 1
      }/${backoff.length + 1})`,
      { amount: job.amount, phone: job.phone }
    );

  setTimeout(() => {
    const latest = useTransactionStore.getState().transactions.find((t) => t.id === job.txnId);

    if (!latest || latest.status !== 'failed') {
      return;
    }

    void retryDelivery(latest);
  }, delayMs);
}

/**
 * Re-run delivery for a failed order from the Orders screen's "Requeue"
 * action. Rebuilds the USSD dial plan and dials again from the same
 * per-network execution SIM — entirely local, no backend involved.
 */
export async function retryDelivery(txn: LocalTransaction) {
  const log = useActivityStore.getState().addLog;

  const executionSubId =
    txn.network === 'airtel'
      ? useSimStore.getState().airtelExecutionSubscriptionId
      : useSimStore.getState().safaricomExecutionSubscriptionId;

  if (executionSubId == null) {
    log(
      'error',
      `No execution SIM configured for ${txn.network} — set it in Settings`
    );

    return;
  }

  const job = planFulfillment(txn.phone, txn.amount);

  if (!job) {
    log('error', `Cannot retry ${txn.ref}: invalid phone/amount`);
    return;
  }

  useTransactionStore.getState().bumpAttempts(txn.id);

  enqueueDial({
    kind: 'sambaza',
    txnId: txn.id,
    network: txn.network,
    amount: txn.amount,
    phone: txn.phone,
    executionSubId,
    dials: job.dials,
    summary: job.summary,
  });
}

/**
 * Dial a USSD code with a timeout.
 */
function dialWithTimeout(
  ussdCode: string,
  subscriptionId: number,
  menuInputs: string[],
  timeoutMs: number,
  // true = strict Sambaza/Airtel transfer-confirmation classifier
  // (real deliveries must never be reported successful on an
  // unrecognized/failure response). false = any non-blank response
  // counts as success, for callers that validate the text themselves.
  expectSambazaConfirmation: boolean,
  // Delay (ms) between each step of a multi-step dial — see Settings →
  // USSD Settings → Key Input Delay. Defaults to the value this used to
  // be hardcoded to on the native side, for callers that don't care.
  keyInputDelayMs: number = 250
): Promise<{ success: boolean; result: string }> {
  return new Promise((resolve) => {
    let settled = false;

    const subscription = UssdExecutor.addListener(
      'onUssdResult',
      (event: any) => {
        if (settled) {
          return;
        }

        settled = true;

        subscription.remove();
        clearTimeout(timer);

        resolve({
          success: Boolean(event?.success),
          result: String(event?.result ?? ''),
        });
      }
    );

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;

      subscription.remove();

      resolve({
        success: false,
        result: 'Timed out waiting for USSD response',
      });
    }, timeoutMs);

    try {
      UssdExecutor.dialUssd(
        ussdCode,
        subscriptionId,
        menuInputs,
        expectSambazaConfirmation,
        keyInputDelayMs
      );
    } catch (e: any) {
      if (settled) {
        return;
      }

      settled = true;

      subscription.remove();
      clearTimeout(timer);

      resolve({
        success: false,
        result: String(e?.message ?? e),
      });
    }
  });
}

/**
 * Manually trigger a delivery without waiting for a payment SMS — for
 * support/testing, or to resolve an entry from the Unmatched bucket once
 * you know the real phone/amount. Order-shaped (unlike manualDial, which
 * just fires a raw USSD code): it goes through the same planFulfillment
 * queue as an SMS-triggered order, so it shows up on the Orders/Airtime
 * screens with the same tracking, retries and WhatsApp notifications.
 */
export async function manualDeliver(input: {
  phone: string; // local format, e.g. 0735830024
  amount: number;
  network: 'safaricom' | 'airtel';
}): Promise<{ ok: boolean; reason?: string; txnId?: string }> {
  const log = useActivityStore.getState().addLog;
  const { phone, amount, network } = input;

  const executionSubId =
    network === 'airtel'
      ? useSimStore.getState().airtelExecutionSubscriptionId
      : useSimStore.getState().safaricomExecutionSubscriptionId;

  if (executionSubId == null) {
    const reason = `No execution SIM configured for ${network} — set it in Settings`;
    log('error', reason);
    return { ok: false, reason };
  }

  const job = planFulfillment(phone, amount);

  if (!job) {
    const reason = `Invalid phone or amount (phone=${phone}, amount=${amount})`;
    log('error', reason);
    return { ok: false, reason };
  }

  log('info', `Manual delivery: ${network} KES ${amount} to ${phone}. ${job.summary}`, {
    amount,
    phone,
  });

  const txnId = useTransactionStore.getState().addPending({
    ref: `MANUAL-${Date.now()}`,
    receipt: null,
    network,
    phone,
    amount,
  });

  enqueueDial({
    kind: 'sambaza',
    txnId,
    network,
    amount,
    phone,
    executionSubId,
    dials: job.dials,
    summary: job.summary,
  });

  return { ok: true, txnId };
}

/**
 * Manual test dial from the UI (e.g. a future USSD Console screen).
 * Pass the subscriptionId to dial from explicitly — now that execution SIM
 * is chosen per network (Safaricom/Airtel), there's no single "the" dial
 * SIM to default to.
 */
export async function manualDial(
  ussdCode: string,
  subscriptionId: number,
  menuInputs: string[] = [],
  // Manual test dial from Settings can be any USSD code, not just a
  // Sambaza delivery — default to lenient (any non-blank response counts)
  // rather than forcing it through the delivery-only classifier.
  expectSambazaConfirmation = false
) {
  const callOk = await requestCallPermission();

  if (!callOk) {
    throw new Error('CALL_PHONE denied');
  }

  if (!UssdExecutor.isAccessibilityEnabled()) {
    UssdExecutor.openAccessibilitySettings();

    throw new Error('Accessibility service not enabled');
  }

  if (subscriptionId == null || subscriptionId < 0) {
    throw new Error('No SIM specified for USSD dialing');
  }

  return dialWithTimeout(
    ussdCode,
    subscriptionId,
    menuInputs,
    useAppSettingsStore.getState().ussdTimeoutMs,
    expectSambazaConfirmation,
    useAppSettingsStore.getState().keyInputDelayMs
  );
}
