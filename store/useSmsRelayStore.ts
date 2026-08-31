import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Forwards incoming SMS matching a rule to another number, via the
 * existing native sendGuidingSms() pipeline (services/smsSender.ts).
 * Independent of the payment-processing pipeline in smsAutomation.ts —
 * see services/smsRelay.ts, hooked into processSmsPayload() before any
 * Till-SIM/trusted-sender filtering, so relay rules can match SMS on
 * any SIM from any sender (e.g. forwarding OTPs, alerts, or a second
 * copy of payment confirmations to another device/number).
 */

export type RelayRule = {
  id: string;
  name: string;
  senderPattern: string; // case-insensitive substring match against SMS sender
  sourceSubscriptionId: number | 'any';
  minAmount: number | null;
  maxAmount: number | null;
  targetNumber: string;
  enabled: boolean;
  createdAt: string;
  matchCount: number;
  lastMatchedAt: string | null;
};

type State = {
  rules: RelayRule[];

  addRule: (input: {
    name: string;
    senderPattern: string;
    sourceSubscriptionId: number | 'any';
    minAmount: number | null;
    maxAmount: number | null;
    targetNumber: string;
  }) => string;
  updateRule: (id: string, patch: Partial<RelayRule>) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  recordMatch: (id: string) => void;
};

export const useSmsRelayStore = create<State>()(
  persist(
    (set) => ({
      rules: [],

      addRule: (input) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        set((s) => ({
          rules: [
            {
              id,
              name: input.name,
              senderPattern: input.senderPattern,
              sourceSubscriptionId: input.sourceSubscriptionId,
              minAmount: input.minAmount,
              maxAmount: input.maxAmount,
              targetNumber: input.targetNumber,
              enabled: true,
              createdAt: new Date().toISOString(),
              matchCount: 0,
              lastMatchedAt: null,
            },
            ...s.rules,
          ],
        }));
        return id;
      },

      updateRule: (id, patch) => {
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        }));
      },

      removeRule: (id) => {
        set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
      },

      toggleRule: (id) => {
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
        }));
      },

      recordMatch: (id) => {
        set((s) => ({
          rules: s.rules.map((r) =>
            r.id === id
              ? { ...r, matchCount: r.matchCount + 1, lastMatchedAt: new Date().toISOString() }
              : r
          ),
        }));
      },
    }),
    {
      name: 'webazi-sms-relay-store',
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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SimSlot = {
  subscriptionId: number;
  slotIndex: number;
  carrierName: string | null;
  displayName?: string | null;
  number: string | null;
};

type State = {
  // Receiving SIM: the M-PESA Till line. All payment SMS (Safaricom or
  // Airtel orders alike) arrive here — this never changes per network.
  tillSubscriptionId: number | null;

  // Execution SIMs: which SIM actually dials the delivery USSD, chosen by
  // the network encoded in the account ref ("S" -> Safaricom clients get
  // airtime dialed from the Safaricom line, "A" -> Airtel clients get
  // airtime dialed from the Airtel line). Independent of the Till SIM.
  safaricomExecutionSubscriptionId: number | null;
  airtelExecutionSubscriptionId: number | null;

  availableSims: SimSlot[];
  smsListening: boolean;
  setTillSim: (id: number | null) => void;
  setSafaricomExecutionSim: (id: number | null) => void;
  setAirtelExecutionSim: (id: number | null) => void;
  setAvailableSims: (sims: SimSlot[]) => void;
  setSmsListening: (v: boolean) => void;
};

export const useSimStore = create<State>()(
  persist(
    (set) => ({
      tillSubscriptionId: null,
      safaricomExecutionSubscriptionId: null,
      airtelExecutionSubscriptionId: null,
      availableSims: [],
      smsListening: false,

      setTillSim: (id) =>
        set({
          tillSubscriptionId: id,
        }),

      setSafaricomExecutionSim: (id) =>
        set({
          safaricomExecutionSubscriptionId: id,
        }),

      setAirtelExecutionSim: (id) =>
        set({
          airtelExecutionSubscriptionId: id,
        }),

      setAvailableSims: (sims) =>
        set({
          availableSims: sims,
        }),

      setSmsListening: (v) =>
        set({
          smsListening: v,
        }),
    }),
    {
      name: 'webazi-sim-store',

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

      partialize: (state) => ({
        ...state,
        tillSubscriptionId: state.tillSubscriptionId,
        safaricomExecutionSubscriptionId: state.safaricomExecutionSubscriptionId,
        airtelExecutionSubscriptionId: state.airtelExecutionSubscriptionId,
      }),
    }
  )
);
