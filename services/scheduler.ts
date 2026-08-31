/**
 * USSD Scheduler runtime.
 *
 * This loop polls every 30s for due items. On its own, a JS setInterval
 * only runs while the app's process is alive — Android is free to kill
 * a backgrounded process, which used to mean a schedule whose runAt time
 * passed while the app was closed would only fire once the app was
 * reopened.
 *
 * FIX: startSchedulerLoop() now also starts SchedulerForegroundService
 * (modules/scheduler-service), a native foreground service — modeled
 * directly on the SMS listener's SmsForegroundService — that keeps this
 * process alive in the background with a persistent low-priority
 * notification, the same way normal SMS-triggered transactions already
 * survive backgrounding. The scheduling logic below is unchanged; only
 * the process it runs inside is now protected from being killed.
 */

import { useScheduleStore } from '../store/useScheduleStore';
import type { ScheduledDial } from '../store/useScheduleStore';
import { useActivityStore } from '../store/useActivityStore';
import { manualDeliver } from './smsAutomation';
import { runDueFloatChecks } from './floatCheck';
import { sendTemplateNotification } from './notificationTemplates';
import { useRecommendationTrackerStore } from '../store/useRecommendationTrackerStore';
import SchedulerService from '../modules/scheduler-service/src/SchedulerServiceModule';

const CHECK_INTERVAL_MS = 30000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startSchedulerLoop() {
  if (intervalHandle) return;

  // Keep the process alive so this interval survives backgrounding.
  // Guarded: safe to call even before a native rebuild has added this
  // module — falls back to the previous foreground-only behavior.
  if (typeof SchedulerService.startForegroundService === 'function') {
    try {
      SchedulerService.startForegroundService();
    } catch {
      // Non-fatal — scheduler still runs while the app is foregrounded.
    }
  }

  intervalHandle = setInterval(() => {
    void runDueSchedules();
  }, CHECK_INTERVAL_MS);

  void runDueSchedules();
}

export function stopSchedulerLoop() {
  // Stop the foreground service alongside the interval — see the note
  // in Section 4 of the accompanying fix doc if this service is later
  // merged with the SMS listener's into one shared service, since that
  // would need reference counting instead of an unconditional stop here.
  if (typeof SchedulerService.stopForegroundService === 'function') {
    try {
      SchedulerService.stopForegroundService();
    } catch {
      // Non-fatal.
    }
  }

  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runDueSchedules() {
  if (running) return;
  running = true;

  try {
    const log = useActivityStore.getState().addLog;
    const now = Date.now();
    const due = useScheduleStore
      .getState()
      .items.filter(
        (item) =>
          item.active &&
          (item.limit == null || item.runsCompleted < item.limit) &&
          new Date(item.runAt).getTime() <= now
      );

    for (const item of due) {
      log('info', `Running scheduled dial "${item.label}"`);

      const result = await manualDeliver({
        phone: item.phone,
        amount: item.amount,
        network: item.network,
      });

      if (result.ok) {
        void sendTemplateNotification({
          event: 'scheduled',
          planId: null,
          phone: item.phone,
          data: {
            transactionId: result.txnId,
            amount: item.amount,
            package: item.label,
            status: 'Scheduled',
          },
        }).catch(() => {});
      }

      if (result.ok) {
        // Only a successful queue counts as a real run: advance
        // runsCompleted/runAt (and possibly deactivate a 'once'
        // schedule or exhaust its limit).
        const nextRunAt = computeNextRun(item);
        useScheduleStore.getState().recordRun(item.id, 'Queued', nextRunAt);
      } else {
        // Failed to even queue (e.g. no execution SIM configured yet).
        // Record the failure for visibility, but leave runAt/active/
        // runsCompleted untouched so this item is still due on the next
        // 30s tick and gets retried soon — instead of a 'once' schedule
        // silently deactivating, or a recurring one burning a slot
        // against its limit and skipping ahead to its next scheduled
        // time.
        useScheduleStore.getState().recordFailedQueue(item.id, result.reason ?? 'Failed to queue');
      }
    }

    // Float/balance check — cheap no-op unless checkIntervalHours has
    // elapsed for a network; shares this same 30s loop rather than
    // running its own timer.
    await runDueFloatChecks();

    // Drop "already recommended today" entries from a previous day.
    // Cheap (capped at 500 entries) so it's fine to run on every tick
    // of this same loop rather than needing its own timer.
    useRecommendationTrackerStore.getState().pruneOldEntries();
  } finally {
    running = false;
  }
}

function computeNextRun(item: ScheduledDial): string | null {
  if (item.recurrence === 'once') {
    return null;
  }

  const dayMs = 24 * 60 * 60 * 1000;

  // Base the next run off whichever is later: the originally scheduled
  // time, or right now. If the app was closed and this run fired late
  // (runAt is in the past), basing off the stale runAt would put the
  // "next" run in the past too — the 30s poll would then fire it again
  // almost immediately, repeating every 30s until it caught up to the
  // present. Real airtime would go out multiple times for what should
  // have been a single missed run. Basing off now() when late collapses
  // any missed occurrences into a single catch-up run and schedules the
  // next one properly in the future.
  const base = Math.max(new Date(item.runAt).getTime(), Date.now());
  const next = item.recurrence === 'daily' ? base + dayMs : base + 7 * dayMs;

  return new Date(next).toISOString();
}
