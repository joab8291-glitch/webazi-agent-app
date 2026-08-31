import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Fully local schedule of one-off/recurring manual deliveries — the
 * "USSD Scheduler". A schedule fires by calling manualDeliver() once its
 * runAt time has passed. Since there's no background task runner in this
 * app, firing only happens while the app is open (checked periodically —
 * see services/scheduler.ts). A schedule due while the app was closed
 * fires as soon as the app is reopened.
 */

export type ScheduleRecurrence = 'once' | 'daily' | 'weekly';

export type ScheduledDial = {
  id: string;
  label: string;
  phone: string;
  amount: number;
  network: 'safaricom' | 'airtel';
  runAt: string; // ISO datetime of the next (or only) run
  recurrence: ScheduleRecurrence;
  limit: number | null; // max total runs; null = unlimited (recurring only)
  runsCompleted: number;
  active: boolean;
  createdAt: string;
  lastRunAt: string | null;
  lastRunResult: string | null;
};

type State = {
  items: ScheduledDial[];
  addSchedule: (input: {
    label: string;
    phone: string;
    amount: number;
    network: 'safaricom' | 'airtel';
    runAt: string;
    recurrence: ScheduleRecurrence;
    limit: number | null;
  }) => string;
  removeSchedule: (id: string) => void;
  setActive: (id: string, active: boolean) => void;
  recordRun: (id: string, resultText: string, nextRunAt: string | null) => void;
  /** A run that failed before it even reached the queue (e.g. no
   * execution SIM configured). Distinct from recordRun: this does NOT
   * advance runsCompleted or runAt, and does NOT touch `active` — the
   * item stays exactly as due as it was, so the next scheduler tick
   * retries it soon instead of a 'once' item silently deactivating or
   * a recurring item burning a slot against its limit. */
  recordFailedQueue: (id: string, resultText: string) => void;
};

export const useScheduleStore = create<State>()(
  persist(
    (set) => ({
      items: [],

      addSchedule: ({ label, phone, amount, network, runAt, recurrence, limit }) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        set((s) => ({
          items: [
            {
              id,
              label,
              phone,
              amount,
              network,
              runAt,
              recurrence,
              limit,
              runsCompleted: 0,
              active: true,
              createdAt: new Date().toISOString(),
              lastRunAt: null,
              lastRunResult: null,
            },
            ...s.items,
          ],
        }));

        return id;
      },

      removeSchedule: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },

      setActive: (id, active) => {
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, active } : i)),
        }));
      },

      recordRun: (id, resultText, nextRunAt) => {
        set((s) => ({
          items: s.items.map((it) => {
            if (it.id !== id) return it;

            const runsCompleted = it.runsCompleted + 1;
            const limitReached = it.limit != null && runsCompleted >= it.limit;

            return {
              ...it,
              runsCompleted,
              lastRunAt: new Date().toISOString(),
              lastRunResult: resultText,
              runAt: nextRunAt ?? it.runAt,
              active: nextRunAt != null && !limitReached,
            };
          }),
        }));
      },

      recordFailedQueue: (id, resultText) => {
        set((s) => ({
          items: s.items.map((it) =>
            it.id !== id
              ? it
              : {
                  ...it,
                  lastRunAt: new Date().toISOString(),
                  lastRunResult: resultText,
                }
          ),
        }));
      },
    }),
    {
      name: 'webazi-schedule-store',

      storage: {
        getItem: async (name) => {
          const value = await AsyncStorage.getItem(name);
          return value ? JSON.parse(value) : null;
        },

        setItem: async (name, value) => {
          await AsyncStorage.setItem(name, JSON.stringify(value));
        },

        removeItem: async (name) => {
          await AsyncStorage.removeItem(name);
        },
      },
    }
  )
);
