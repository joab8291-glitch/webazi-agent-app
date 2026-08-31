import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Float/airtime balance on the two execution SIMs (the lines that
 * actually dial delivery USSD). Checked by dialing the network's
 * balance-enquiry USSD code and parsing the response text — same
 * mechanism as a Sambaza dial, just read-only.
 */

export type NetworkKey = 'safaricom' | 'airtel';

export type FloatReading = {
  balance: number | null; // KES, null until first successful check
  raw: string | null; // full USSD response text, for the UI/debug
  checkedAt: string | null; // ISO
  checking: boolean;
  lastError: string | null;
};

const EMPTY_READING: FloatReading = {
  balance: null,
  raw: null,
  checkedAt: null,
  checking: false,
  lastError: null,
};

type State = {
  safaricom: FloatReading;
  airtel: FloatReading;

  // KES threshold below which a network is flagged low. Independent
  // per network since Safaricom/Airtel float doesn't move together.
  lowBalanceThreshold: number;
  setLowBalanceThreshold: (kes: number) => void;

  // How often the scheduler loop should auto-check float, in hours.
  // 0 disables the automatic check (manual "Check now" still works).
  checkIntervalHours: number;
  setCheckIntervalHours: (hours: number) => void;

  // Local push alert when a network's float drops below the threshold.
  // Fires once per dip — cleared automatically once balance recovers
  // back above lowBalanceThreshold, so it can fire again on a future dip.
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  lowAlerted: Partial<Record<NetworkKey, boolean>>;

  setChecking: (network: NetworkKey, checking: boolean) => void;
  recordReading: (network: NetworkKey, balance: number, raw: string) => void;
  recordError: (network: NetworkKey, error: string) => void;
};

export const useFloatStore = create<State>()(
  persist(
    (set) => ({
      safaricom: EMPTY_READING,
      airtel: EMPTY_READING,

      lowBalanceThreshold: 50,
      setLowBalanceThreshold: (kes) =>
        set({ lowBalanceThreshold: Math.max(0, Math.round(kes)) }),

      checkIntervalHours: 6,
      setCheckIntervalHours: (hours) =>
        set({ checkIntervalHours: Math.max(0, hours) }),

      notificationsEnabled: true,
      setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
      lowAlerted: {},

      setChecking: (network, checking) =>
        set((s) => ({ [network]: { ...s[network], checking } } as Partial<State>)),

      recordReading: (network, balance, raw) =>
        set((s) => ({
          [network]: {
            ...s[network],
            balance,
            raw,
            checkedAt: new Date().toISOString(),
            checking: false,
            lastError: null,
          },
          lowAlerted:
            balance >= s.lowBalanceThreshold
              ? { ...s.lowAlerted, [network]: false }
              : s.lowAlerted,
        } as Partial<State>)),

      recordError: (network, error) =>
        set((s) => ({
          [network]: { ...s[network], checking: false, lastError: error },
        } as Partial<State>)),
    }),
    {
      name: 'webazi-float-store',
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
      // Never persist "checking" as true — a check in progress when the
      // app was killed should read as idle on next launch, not stuck.
      partialize: (state) => ({
        ...state,
        safaricom: { ...state.safaricom, checking: false },
        airtel: { ...state.airtel, checking: false },
      }),
    }
  )
);
