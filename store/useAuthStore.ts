import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Agent account: a Notification Number + password pair set up once on
 * this device. isLoggedIn is intentionally excluded from persistence —
 * every fresh app launch requires logging back in (Notification Number
 * + password, verified live against the SIM via services/numberVerification.ts),
 * even though the account itself survives restarts.
 */

type State = {
  notificationNumber: string | null;
  password: string | null;
  isSetUp: boolean;
  isLoggedIn: boolean;
  lastVerifiedNumber: string | null;
  /** ISO timestamp of the very first successful login. Set once, never
   * cleared by logout — it anchors the one-time 7-day trial period
   * (see services/subscription.ts), which should not reset just because
   * the agent logs out and back in. */
  firstLoginAt: string | null;

  /** Central-DB identity, set once register/login against the backend
   * succeeds (see services/agentBackend.ts). Null until the first time
   * this device is online during setup/login — everything still works
   * offline before that using purely local trial logic, it just isn't
   * centrally tracked yet until connectivity happens once. */
  agentId: string | null;
  agentKey: string | null;

  completeSetup: (notificationNumber: string, password: string) => void;
  updateCredentials: (notificationNumber: string, password: string) => void;
  setLoggedIn: (v: boolean, verifiedNumber?: string | null) => void;
  setAgentIdentity: (agentId: string, agentKey: string) => void;
  logout: () => void;
};

export const useAuthStore = create<State>()(
  persist(
    (set, get) => ({
      notificationNumber: null,
      password: null,
      isSetUp: false,
      isLoggedIn: false,
      lastVerifiedNumber: null,
      firstLoginAt: null,
      agentId: null,
      agentKey: null,

      setAgentIdentity: (agentId, agentKey) => set({ agentId, agentKey }),

      completeSetup: (notificationNumber, password) =>
        set({ notificationNumber: notificationNumber.trim(), password, isSetUp: true }),

      updateCredentials: (notificationNumber, password) =>
        set({ notificationNumber: notificationNumber.trim(), password }),

      setLoggedIn: (v, verifiedNumber) =>
        set({
          isLoggedIn: v,
          lastVerifiedNumber: v ? verifiedNumber ?? null : null,
          firstLoginAt: v && !get().firstLoginAt ? new Date().toISOString() : get().firstLoginAt,
        }),

      logout: () => set({ isLoggedIn: false, lastVerifiedNumber: null }),
    }),
    {
      name: 'webazi-auth-store',

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

      // isLoggedIn / lastVerifiedNumber are session-only — omitted here
      // so every cold start rehydrates isLoggedIn back to false.
      // firstLoginAt IS persisted — it must survive restarts and logout,
      // since it's the fixed anchor for the one-time trial period.
      partialize: (state) => ({
        notificationNumber: state.notificationNumber,
        password: state.password,
        isSetUp: state.isSetUp,
        firstLoginAt: state.firstLoginAt,
        agentId: state.agentId,
        agentKey: state.agentKey,
      }),
    }
  )
);
