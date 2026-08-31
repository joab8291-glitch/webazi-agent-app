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
