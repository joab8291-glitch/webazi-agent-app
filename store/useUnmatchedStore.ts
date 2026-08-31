import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Fully local list of SMS received on the Till SIM that could NOT be
 * turned into an order — either there was no account reference at all
 * (a balance notice, a P2P receipt, etc.) or there was one but it didn't
 * decode (corrupted/foreign format). Kept so a paid customer whose SMS
 * failed to parse isn't silently lost — support can look here and
 * resolve manually via the USSD Console's manual recommendation form.
 */

export type UnmatchedReason = 'no_ref' | 'undecodable_ref' | 'no_matching_plan';

export type UnmatchedSms = {
  id: string;
  sender: string;
  subscriptionId: number;
  bodyPreview: string;
  reason: UnmatchedReason;
  ref: string | null;
  receivedAt: string;
};

const MAX_UNMATCHED = 200;

type State = {
  items: UnmatchedSms[];
  addUnmatched: (input: {
    sender: string;
    subscriptionId: number;
    body: string;
    reason: UnmatchedReason;
    ref?: string | null;
  }) => string;
  remove: (id: string) => void;
  clear: () => void;
};

export const useUnmatchedStore = create<State>()(
  persist(
    (set) => ({
      items: [],

      addUnmatched: ({ sender, subscriptionId, body, reason, ref }) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        set((s) => ({
          items: [
            {
              id,
              sender,
              subscriptionId,
              bodyPreview: body.slice(0, 160),
              reason,
              ref: ref ?? null,
              receivedAt: new Date().toISOString(),
            },
            ...s.items,
          ].slice(0, MAX_UNMATCHED),
        }));

        return id;
      },

      remove: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },

      clear: () => set({ items: [] }),
    }),
    {
      name: 'webazi-unmatched-store',

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
