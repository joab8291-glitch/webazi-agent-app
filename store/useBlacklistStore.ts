import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { last9Digits } from '../services/numberVerification';

/**
 * Fully local list of customer phone numbers this agent has restricted
 * from receiving Data Plan deliveries. A number here still pays (the
 * M-Pesa side is out of the agent's control), but the delivery pipeline
 * (services/smsAutomation.ts → tryHandleDataPlanPayment) skips dialing
 * for it and fires the "Blacklisted" Notification Template instead, so
 * the agent can still see the payment came in and follow up manually.
 *
 * Numbers are matched on the last 9 digits (see services/numberVerification.ts
 * → last9Digits) so 07.../01.../254.../+254... all resolve to the same entry.
 */

export type BlacklistEntry = {
  id: string;
  phone: string; // as entered, for display
  reason: string | null;
  addedAt: string;
};

type State = {
  items: BlacklistEntry[];
  add: (phone: string, reason?: string | null) => string;
  remove: (id: string) => void;
  isBlacklisted: (phone: string) => boolean;
};

export const useBlacklistStore = create<State>()(
  persist(
    (set, get) => ({
      items: [],

      add: (phone, reason) => {
        const key = last9Digits(phone);
        const existing = get().items.find((i) => last9Digits(i.phone) === key);
        if (existing) return existing.id;

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        set((s) => ({
          items: [
            { id, phone, reason: reason ?? null, addedAt: new Date().toISOString() },
            ...s.items,
          ],
        }));
        return id;
      },

      remove: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },

      isBlacklisted: (phone) => {
        const key = last9Digits(phone);
        if (!key) return false;
        return get().items.some((i) => last9Digits(i.phone) === key);
      },
    }),
    {
      name: 'webazi-blacklist-store',
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
