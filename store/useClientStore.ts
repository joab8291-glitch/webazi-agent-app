import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { last9Digits } from '../services/numberVerification';

/**
 * Fully local record of every customer who has ever paid successfully,
 * built entirely from confirmed deliveries — see
 * services/clientTracking.ts, hooked into useTransactionStore's
 * markCompleted(). Backs both the Client Metrics dashboard and the
 * Client → Contacts Sync feature; keyed by last-9-digits so different
 * phone formats (07.../254.../+254...) all resolve to the same client.
 */

export type ClientRecord = {
  key: string; // last9Digits — stable identity
  phone: string; // most recently seen display format
  name: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  totalSpent: number;
  purchaseCount: number;
  /** Set once this client has been pushed to device Contacts, so we
   * know whether to add vs update on the next sync. */
  contactSyncedAt: string | null;
};

type State = {
  clients: Record<string, ClientRecord>;

  recordPurchase: (input: { phone: string; amount: number; name?: string | null }) => ClientRecord | null;
  markContactSynced: (key: string) => void;
  reset: () => void;
};

export const useClientStore = create<State>()(
  persist(
    (set, get) => ({
      clients: {},

      recordPurchase: ({ phone, amount, name }) => {
        const key = last9Digits(phone);
        if (!key) return null;

        const now = new Date().toISOString();
        const existing = get().clients[key];

        const updated: ClientRecord = existing
          ? {
              ...existing,
              phone,
              name: name ?? existing.name,
              lastSeenAt: now,
              totalSpent: existing.totalSpent + amount,
              purchaseCount: existing.purchaseCount + 1,
            }
          : {
              key,
              phone,
              name: name ?? null,
              firstSeenAt: now,
              lastSeenAt: now,
              totalSpent: amount,
              purchaseCount: 1,
              contactSyncedAt: null,
            };

        set((s) => ({ clients: { ...s.clients, [key]: updated } }));
        return updated;
      },

      markContactSynced: (key) => {
        set((s) => {
          const existing = s.clients[key];
          if (!existing) return s;
          return {
            clients: {
              ...s.clients,
              [key]: { ...existing, contactSyncedAt: new Date().toISOString() },
            },
          };
        });
      },

      reset: () => set({ clients: {} }),
    }),
    {
      name: 'webazi-client-store',
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
