/**
 * Export local orders as CSV for reconciliation against the day's
 * M-Pesa statement. No filesystem/sharing native module is installed,
 * so this hands the CSV text to React Native's built-in Share sheet —
 * "Save to Files", email, WhatsApp, etc. all work from there.
 */

import { Share } from 'react-native';
import type { LocalTransaction } from '../store/useTransactionStore';

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildOrdersCsv(transactions: LocalTransaction[]): string {
  const header = [
    'created_at',
    'network',
    'phone',
    'amount',
    'delivered_amount',
    'status',
    'attempts',
    'possible_duplicate',
    'receipt',
    'ref',
    'failure_reason',
  ];

  const rows = transactions.map((t) =>
    [
      t.createdAt,
      t.network,
      t.phone,
      t.amount,
      t.deliveredAmount,
      t.status,
      t.attempts,
      t.possibleDuplicate ? 'yes' : '',
      t.receipt ?? '',
      t.ref,
      t.failureReason ?? '',
    ]
      .map(csvEscape)
      .join(',')
  );

  return [header.join(','), ...rows].join('\n');
}

/**
 * Shares CSV text for the given orders via the native Share sheet.
 * `label` is used in the share dialog title (e.g. "Safaricom orders").
 */
export async function exportOrdersCsv(
  transactions: LocalTransaction[],
  label = 'Webazi orders'
): Promise<void> {
  const csv = buildOrdersCsv(transactions);
  await Share.share(
    {
      title: `${label}.csv`,
      message: csv,
    },
    { dialogTitle: `Export ${label}` }
  );
}
