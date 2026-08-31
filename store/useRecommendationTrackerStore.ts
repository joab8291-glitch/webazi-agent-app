import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { last9Digits } from '../services/numberVerification';

/**
 * Per-day "already recommended" tracker — records that a given phone
 * number was already successfully delivered a given Data Plan today, so
 * services/smsAutomation.ts → tryHandleDataPlanPayment can skip
 * re-dialing a duplicate same-day payment for the same plan and instead
 * fire the "Already recommended" Notification Template. A genuinely new
 * payment for a DIFFERENT plan, or the same plan on a later day, is
 * unaffected.
 *
 * "Today" is the device's local calendar day (YYYY-MM-DD), matching how
 * an agent would describe "already recommended today" — not a rolling
 * 24h window.
 */

export type RecommendationEntry = {
  phone: string; // last-9-digits key
  planId: string;
  day: string; // YYYY-MM-DD, local
  recordedAt: string;
};

const MAX_ENTRIES = 500;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type State = {
  items: RecommendationEntry[];
  recordRecommended: (phone: string, planId: string) => void;
  wasRecommendedToday: (phone: string, planId: string) => boolean;
  /** Drops entries older than today — call periodically (e.g. from the
   * scheduler loop) so the list doesn't grow unbounded with stale days. */
  pruneOldEntries: () => void;
};

export const useRecommendationTrackerStore = create<State>()(
  persist(
    (set, get) => ({
      items: [],

      recordRecommended: (phone, planId) => {
        const key = last9Digits(phone);
        const day = todayKey();
        const already = get().items.some((i) => i.phone === key && i.planId === planId && i.day === day);
        if (already) return;

        set((s) => ({
          items: [{ phone: key, planId, day, recordedAt: new Date().toISOString() }, ...s.items].slice(
            0,
            MAX_ENTRIES
          ),
        }));
      },

      wasRecommendedToday: (phone, planId) => {
        const key = last9Digits(phone);
        const day = todayKey();
        return get().items.some((i) => i.phone === key && i.planId === planId && i.day === day);
      },

      pruneOldEntries: () => {
        const day = todayKey();
        set((s) => ({ items: s.items.filter((i) => i.day === day) }));
      },
    }),
    {
      name: 'webazi-recommendation-tracker-store',
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
