import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { recordCompletedPayment } from '../services/clientTracking';

/**
 * Fully local order tracking. Nothing here talks to the backend — an
 * order exists because handleSms() decoded a payment SMS and dialed
 * USSD, and it's marked completed only once Safaricom's own USSD
 * response confirms delivery. The device is the source of truth.
 */

export type DialResult = {
  ussdCode: string;
  amount: number;
  success: boolean;
  result: string;
};

export type LocalTransaction = {
  id: string;
  ref: string;
  receipt: string | null;
  network: 'safaricom' | 'airtel';
  phone: string;
  amount: number;
  deliveredAmount: number;
  status: 'pending' | 'completed' | 'failed';
  dialResults: DialResult[];
  failureReason: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** Same phone + amount as another order within the last 10 minutes.
   * Flagged for a human glance, never blocks delivery. */
  possibleDuplicate: boolean;
  /** Set when this order was fulfilled against a Data Plans Manager plan
   * rather than the old Sambaza network flow. Undefined for legacy orders. */
  planId?: string;
  planName?: string;
  payerName?: string | null;
};

type State = {
  transactions: LocalTransaction[];
  addPending: (input: {
    ref: string;
    receipt: string | null;
    network: 'safaricom' | 'airtel';
    phone: string;
    amount: number;
    possibleDuplicate?: boolean;
    planId?: string;
    planName?: string;
    payerName?: string | null;
  }) => string;
  recordDialResult: (id: string, dial: DialResult) => void;
  markCompleted: (id: string) => void;
  markFailed: (id: string, reason: string) => void;
  bumpAttempts: (id: string) => void;
  deleteTransaction: (id: string) => void;
  purgeOlderThan: (days: number) => void;
  /** Deletes every order, including pending ones. Used by the "Clear all" buttons. */
  clearAll: () => void;
  /** Deletes every order for one network, including pending ones. */
  clearByNetwork: (network: 'safaricom' | 'airtel') => void;
};

export const useTransactionStore = create<State>()(
  persist(
    (set, get) => ({
      transactions: [],

      addPending: ({ ref, receipt, network, phone, amount, possibleDuplicate, planId, planName, payerName }) => {
        const id = `${ref}-${Date.now()}`;
        const now = new Date().toISOString();

        set((s) => ({
          transactions: [
            {
              id,
              ref,
              receipt,
              network,
              phone,
              amount,
              deliveredAmount: 0,
              status: 'pending',
              dialResults: [],
              failureReason: null,
              attempts: 1,
              createdAt: now,
              updatedAt: now,
              possibleDuplicate: possibleDuplicate ?? false,
              planId,
              planName,
              payerName: payerName ?? null,
            },
            ...s.transactions,
          ],
        }));

        return id;
      },

      recordDialResult: (id, dial) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id
              ? {
                  ...t,
                  dialResults: [...t.dialResults, dial],
                  deliveredAmount: dial.success
                    ? t.deliveredAmount + dial.amount
                    : t.deliveredAmount,
                  updatedAt: new Date().toISOString(),
                }
              : t
          ),
        }));
      },

      markCompleted: (id) => {
        const txn = get().transactions.find((t) => t.id === id);

        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'completed',
                  failureReason: null,
                  updatedAt: new Date().toISOString(),
                }
              : t
          ),
        }));

        // Feeds Client Metrics + Client -> Contacts Sync. Single hook
        // point so every completion path (Sambaza, Data Plans, manual
        // deliver, subscription, customer-payment airtime) is covered
        // without touching each call site individually.
        if (txn) {
          recordCompletedPayment({ phone: txn.phone, amount: txn.amount, name: txn.payerName });
        }
      },

      markFailed: (id, reason) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'failed',
                  failureReason: reason,
                  updatedAt: new Date().toISOString(),
                }
              : t
          ),
        }));
      },

      bumpAttempts: (id) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, attempts: t.attempts + 1 } : t
          ),
        }));
      },

      deleteTransaction: (id) => {
        set((s) => ({
          transactions: s.transactions.filter((t) => t.id !== id),
        }));
      },

      clearAll: () => {
        set({ transactions: [] });
      },

      clearByNetwork: (network) => {
        set((s) => ({
          transactions: s.transactions.filter((t) => t.network !== network),
        }));
      },

      purgeOlderThan: (days) => {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

        set((s) => ({
          // Pending orders are never auto-deleted, regardless of age —
          // only resolved (completed/failed) ones get purged.
          transactions: s.transactions.filter(
            (t) => t.status === 'pending' || new Date(t.createdAt).getTime() >= cutoff
          ),
        }));
      },
    }),
    {
      name: 'webazi-transaction-store',

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
