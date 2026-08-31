import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { computeSubscriptionEndDate, computeTrialEndDate, SubscriptionMonths } from '@/services/subscription';
import { useAuthStore } from './useAuthStore';
import { fetchAgentStatus, AgentRecord } from '@/services/agentBackend';

/**
 * Subscription state, now backed by the central DB (see
 * backend-addon/ delivered alongside this app) instead of being purely
 * local. Design:
 *
 *  - Every login, and every OFFLINE_GRACE_DAYS-ish interval while the
 *    app is open, we ask the server for this agent's real status and
 *    cache it (lastServerStatus / lastServerSyncAt).
 *  - If the server says "revoked", that's final — access is blocked
 *    immediately, even offline, until the server says otherwise. An
 *    agent editing their own AsyncStorage can't undo a revoke, because
 *    revoked is re-checked (and re-cached) on every successful sync.
 *  - If the server is unreachable, we fall back to the last cached
 *    server status if it's still within OFFLINE_GRACE_DAYS. This is
 *    what keeps the app usable with no signal for a few days, per the
 *    original offline-enforcement spec.
 *  - If we've NEVER reached the server (brand new install, offline
 *    since setup) OR the cache is older than the grace window, we fall
 *    back to the pre-backend local computation (trial-from-firstLoginAt
 *    / locally stored subscriptionEndDate) so the app still isn't
 *    bricked for a genuinely new/offline agent — this is the same
 *    trust-the-phone behavior as before, just now the exception rather
 *    than the rule.
 */

const OFFLINE_GRACE_DAYS = 5;

export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'revoked' | 'free';

type State = {
  subscriptionEndDate: string | null;
  lastPaidMonths: SubscriptionMonths | null;
  lastPaidAt: string | null;

  lastServerStatus: AgentRecord['status'] | null;
  lastServerTrialEndsAt: string | null;
  lastServerSubscriptionEndsAt: string | null;
  lastServerSyncAt: string | null;

  registerPayment: (months: SubscriptionMonths) => void;
  syncWithServer: () => Promise<void>;
  getStatus: () => {
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    subscriptionEndsAt: Date | null;
    source: 'server' | 'local-fallback';
  };
};

export const useSubscriptionStore = create<State>()(
  persist(
    (set, get) => ({
      subscriptionEndDate: null,
      lastPaidMonths: null,
      lastPaidAt: null,
      lastServerStatus: null,
      lastServerTrialEndsAt: null,
      lastServerSubscriptionEndsAt: null,
      lastServerSyncAt: null,

      registerPayment: (months) => {
        const now = new Date();
        const end = computeSubscriptionEndDate(now, months);
        set({
          subscriptionEndDate: end.toISOString(),
          lastPaidMonths: months,
          lastPaidAt: now.toISOString(),
        });
      },

      syncWithServer: async () => {
        const { agentId, agentKey } = useAuthStore.getState();
        if (!agentId || !agentKey) return;

        const result = await fetchAgentStatus(agentId, agentKey);
        if (!result.ok) return;

        const agent = result.agent;
        set({
          lastServerStatus: agent.status,
          lastServerTrialEndsAt: agent.trialEndsAt,
          lastServerSubscriptionEndsAt: agent.subscriptionEndsAt,
          lastServerSyncAt: new Date().toISOString(),
        });
      },

      getStatus: () => {
        const now = new Date();
        const {
          lastServerStatus,
          lastServerTrialEndsAt,
          lastServerSubscriptionEndsAt,
          lastServerSyncAt,
          subscriptionEndDate,
        } = get();

        const syncAge = lastServerSyncAt ? now.getTime() - new Date(lastServerSyncAt).getTime() : Infinity;
        const withinGrace = syncAge < OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;

        if (lastServerStatus && withinGrace) {
          return {
            status: lastServerStatus,
            trialEndsAt: lastServerTrialEndsAt ? new Date(lastServerTrialEndsAt) : null,
            subscriptionEndsAt: lastServerSubscriptionEndsAt ? new Date(lastServerSubscriptionEndsAt) : null,
            source: 'server' as const,
          };
        }

        const firstLoginAt = useAuthStore.getState().firstLoginAt;
        const subscriptionEndsAt = subscriptionEndDate ? new Date(subscriptionEndDate) : null;
        if (subscriptionEndsAt && now < subscriptionEndsAt) {
          return { status: 'active' as const, trialEndsAt: null, subscriptionEndsAt, source: 'local-fallback' as const };
        }
        const trialEndsAt = firstLoginAt ? computeTrialEndDate(new Date(firstLoginAt)) : null;
        if (trialEndsAt && now < trialEndsAt) {
          return { status: 'trial' as const, trialEndsAt, subscriptionEndsAt, source: 'local-fallback' as const };
        }
        return { status: 'expired' as const, trialEndsAt, subscriptionEndsAt, source: 'local-fallback' as const };
      },
    }),
    {
      name: 'webazi-subscription-store',
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
