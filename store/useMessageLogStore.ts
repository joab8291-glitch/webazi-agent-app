import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Every SMS from a trusted sender that arrived on the Till SIM — logged
 * here regardless of whether it successfully decoded into an order.
 * Distinct from useUnmatchedStore, which only keeps the ones that FAILED
 * to decode: this is the full raw log, so a "Rerun" button can manually
 * reprocess any specific message when something silently failed, without
 * needing the customer to resend anything.
 */

export type MessageLogStatus =
  | 'queued' // decoded fine, added to the USSD queue
  | 'duplicate' // same receipt already has a transaction — skipped
  | 'no_ref' // no account reference found in the SMS
  | 'undecodable_ref' // had a ref but it didn't decode
  | 'no_matching_plan' // Till/Personal payment, but no Data Plan priced to match
  | 'invalid' // decoded but phone/amount was invalid
  | 'blacklisted' // matched a plan but the payer's number is restricted
  | 'already_recommended'; // matched a plan already delivered to this number today

export type MessageLogSource = 'live' | 'missed_scan' | 'rerun';

export type MessageLogEntry = {
  id: string;
  sender: string;
  subscriptionId: number;
  body: string;
  receivedAt: string;
  status: MessageLogStatus;
  ref: string | null;
  source: MessageLogSource;
};

const MAX_MESSAGES = 300;

type State = {
  items: MessageLogEntry[];
  addMessage: (input: {
    sender: string;
    subscriptionId: number;
    body: string;
    receivedAt: string;
    status: MessageLogStatus;
    ref?: string | null;
    source: MessageLogSource;
  }) => string;
  remove: (id: string) => void;
  clear: () => void;
};

export const useMessageLogStore = create<State>()(
  persist(
    (set) => ({
      items: [],

      addMessage: ({ sender, subscriptionId, body, receivedAt, status, ref, source }) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        set((s) => ({
          items: [
            {
              id,
              sender,
              subscriptionId,
              body,
              receivedAt,
              status,
              ref: ref ?? null,
              source,
            },
            ...s.items,
          ].slice(0, MAX_MESSAGES),
        }));

        return id;
      },

      remove: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },

      clear: () => set({ items: [] }),
    }),
    {
      name: 'webazi-message-log-store',

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
