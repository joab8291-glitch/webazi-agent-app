/**
 * Daily/weekly summary — "lighter version": there's no background task
 * runner installed (no expo-task-manager / background-fetch), so this
 * can't be pushed at a fixed time while the app is closed. Instead, on
 * every app open, this checks whether a day/week has passed since the
 * summary was last shown and — if so — computes totals for that period
 * from local order history and hands them back for the UI to display
 * (a native Alert, in the current wiring).
 */

import { useTransactionStore } from '../store/useTransactionStore';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import type { LocalTransaction } from '../store/useTransactionStore';

export type SummaryPeriod = 'daily' | 'weekly';

export type SummaryStats = {
  period: SummaryPeriod;
  since: string; // ISO
  until: string; // ISO
  ordersDelivered: number;
  kesDelivered: number;
  ordersFailed: number;
  ordersStuckPending: number; // pending orders older than 1 hour, as of now
};

function computeStats(period: SummaryPeriod, since: Date, until: Date): SummaryStats {
  const all = useTransactionStore.getState().transactions;
  const inWindow = (t: LocalTransaction) => {
    const created = new Date(t.createdAt).getTime();
    return created >= since.getTime() && created < until.getTime();
  };

  const windowTxns = all.filter(inWindow);
  const completed = windowTxns.filter((t) => t.status === 'completed');
  const failed = windowTxns.filter((t) => t.status === 'failed');

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const stuckPending = all.filter(
    (t) => t.status === 'pending' && new Date(t.createdAt).getTime() < oneHourAgo
  );

  return {
    period,
    since: since.toISOString(),
    until: until.toISOString(),
    ordersDelivered: completed.length,
    kesDelivered: completed.reduce((sum, t) => sum + t.deliveredAmount, 0),
    ordersFailed: failed.length,
    ordersStuckPending: stuckPending.length,
  };
}

export function formatSummary(stats: SummaryStats): { title: string; body: string } {
  const label = stats.period === 'daily' ? 'Daily summary' : 'Weekly summary';
  const lines = [
    `${stats.ordersDelivered} order${stats.ordersDelivered === 1 ? '' : 's'} delivered · KES ${stats.kesDelivered} total`,
    stats.ordersFailed > 0 ? `${stats.ordersFailed} failed` : null,
    stats.ordersStuckPending > 0
      ? `${stats.ordersStuckPending} order${stats.ordersStuckPending === 1 ? '' : 's'} stuck pending over 1hr — check Orders`
      : null,
  ].filter(Boolean);

  return { title: label, body: lines.join('\n') };
}

/**
 * Checks daily/weekly due-ness and returns stats for whichever period(s)
 * are due, without marking them shown — call markSummaryShown() once the
 * UI has actually displayed it, so a dismissed dialog doesn't silently
 * get skipped next launch.
 */
export function getDueSummaries(): SummaryStats[] {
  const settings = useAppSettingsStore.getState();
  const now = new Date();
  const due: SummaryStats[] = [];

  if (settings.dailySummaryEnabled) {
    if (settings.lastDailySummaryAt == null) {
      // First-ever launch: nothing to summarize yet — just start the
      // clock instead of popping an empty "0 orders" summary.
      settings.setLastDailySummaryAt(now.toISOString());
    } else {
      const last = new Date(settings.lastDailySummaryAt);
      if (now.getTime() - last.getTime() >= 24 * 60 * 60 * 1000) {
        due.push(computeStats('daily', last, now));
      }
    }
  }

  if (settings.weeklySummaryEnabled) {
    if (settings.lastWeeklySummaryAt == null) {
      settings.setLastWeeklySummaryAt(now.toISOString());
    } else {
      const last = new Date(settings.lastWeeklySummaryAt);
      if (now.getTime() - last.getTime() >= 7 * 24 * 60 * 60 * 1000) {
        due.push(computeStats('weekly', last, now));
      }
    }
  }

  return due;
}

export function markSummaryShown(period: SummaryPeriod) {
  const nowIso = new Date().toISOString();
  if (period === 'daily') {
    useAppSettingsStore.getState().setLastDailySummaryAt(nowIso);
  } else {
    useAppSettingsStore.getState().setLastWeeklySummaryAt(nowIso);
  }
}
