import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Data Plans Manager store.
 *
 * Replaces the old Sambaza-only airtime-manager. A "plan" is any named
 * offer an agent sells (data bundle, minutes, SMS bundle, etc.) with its
 * own USSD dial template.
 *
 * Some Safaricom offers are only reachable through a given USSD path
 * during part of the day — the *same* offer sits at a different menu
 * position at night (11PM–3:59AM) than it does in the afternoon/evening
 * (4PM–11PM), because Safaricom's own USSD menu numbering shifts.
 *
 * To handle that without forcing the agent to create two duplicate
 * plans, a single DataPlan can carry TWO ussd variants ("day" and
 * "night"), each with its own time window. If a plan isn't
 * time-configured, it just uses `ussd` (single template) like a normal
 * always-available offer.
 *
 * USSD templates use "pn" as the customer-phone placeholder, e.g.
 *   *180*5*2*pn*1*1#
 * substituted at dial time with the local 0XXXXXXXXX number.
 */

export type PaymentMode = 'Till SIM' | 'Paybill SIM' | 'Personal SIM';
export type SimChoice = 'SIM 1' | 'SIM 2';
export type UssdType = 'simple' | 'advanced' | 'normal';

/** One time-windowed USSD variant of a plan. */
export type UssdVariant = {
  id: string;
  label: string; // e.g. "Night (11PM–3:59AM)"
  ussd: string; // template, contains "pn"
  startHour: number; // 0-23, inclusive
  startMinute: number; // 0-59
  endHour: number; // 0-23
  endMinute: number; // 0-59, window may wrap past midnight
};

export type DataPlan = {
  id: string;
  category: string; // free-text label: Data, Hourly Data, Weekly Data, Minutes, Sms Bundle, etc.
  name: string;
  enabled: boolean;
  pointsEnabled: boolean;

  sellingPrice: number;
  safaricomPrice: number;

  paymentMode: PaymentMode;
  executeSim: SimChoice;
  notificationSim: SimChoice;
  ussdType: UssdType;

  autoRetry: boolean;
  retryCount: number;
  retryOnPending: boolean;
  retryOnFailed: boolean;

  /** When false, `ussd` is used at any time. When true, `ussdVariants` are
   * checked against the current time and the matching one is dialed;
   * outside all windows the plan is treated as unavailable right now. */
  timeConfigured: boolean;
  ussd: string;
  ussdVariants: UssdVariant[];

  createdAt: string;
  updatedAt: string;
};

/**
 * Shape of the JSON an agent exports from Data Plans Manager. Meant to be
 * handed (via file share, WhatsApp, etc.) to another agent, who imports it
 * on their own device to set up the same plans in their own app — see
 * exportPlansJson / importPlans below and services/planExport.ts.
 */
export type DataPlanExport = {
  type: 'webazi-data-plans-export';
  version: 1;
  exportedAt: string;
  planCount: number;
  plans: DataPlan[];
};

export type ImportPlansMode = 'merge' | 'replace';

type State = {
  plans: DataPlan[];
  addPlan: (plan: Omit<DataPlan, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updatePlan: (id: string, patch: Partial<Omit<DataPlan, 'id' | 'createdAt'>>) => void;
  deletePlan: (id: string) => void;
  copyPlan: (id: string) => string | null;
  togglePlanEnabled: (id: string) => void;
  bulkAdjustPrices: (percent: number, category?: string) => void;
  /** Serializes plans (all, or just the given ids) into the shareable export JSON. */
  exportPlansJson: (planIds?: string[]) => string;
  /**
   * Adds imported plans to the store. Each gets a fresh id/timestamps so it
   * never collides with the importing agent's existing plans, even if the
   * export came from this same app. 'merge' appends to existing plans;
   * 'replace' wipes existing plans first.
   */
  importPlans: (plans: DataPlan[], mode: ImportPlansMode) => { imported: number };
};

function newId() {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useDataPlanStore = create<State>()(
  persist(
    (set, get) => ({
      plans: [],

      addPlan: (plan) => {
        const id = newId();
        const now = new Date().toISOString();
        set((s) => ({
          plans: [...s.plans, { ...plan, id, createdAt: now, updatedAt: now }],
        }));
        return id;
      },

      updatePlan: (id, patch) =>
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p
          ),
        })),

      deletePlan: (id) => set((s) => ({ plans: s.plans.filter((p) => p.id !== id) })),

      copyPlan: (id) => {
        const src = get().plans.find((p) => p.id === id);
        if (!src) return null;
        const newPlanId = newId();
        const now = new Date().toISOString();
        set((s) => ({
          plans: [
            ...s.plans,
            {
              ...src,
              id: newPlanId,
              name: `${src.name} (copy)`,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }));
        return newPlanId;
      },

      togglePlanEnabled: (id) =>
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === id ? { ...p, enabled: !p.enabled, updatedAt: new Date().toISOString() } : p
          ),
        })),

      bulkAdjustPrices: (percent, category) =>
        set((s) => ({
          plans: s.plans.map((p) => {
            if (category && category !== 'All' && p.category !== category) return p;
            const factor = 1 + percent / 100;
            return {
              ...p,
              sellingPrice: Math.max(0, Math.round(p.sellingPrice * factor)),
              updatedAt: new Date().toISOString(),
            };
          }),
        })),

      exportPlansJson: (planIds) => {
        const all = get().plans;
        const selected =
          planIds && planIds.length > 0 ? all.filter((p) => planIds.includes(p.id)) : all;
        const payload: DataPlanExport = {
          type: 'webazi-data-plans-export',
          version: 1,
          exportedAt: new Date().toISOString(),
          planCount: selected.length,
          plans: selected,
        };
        return JSON.stringify(payload, null, 2);
      },

      importPlans: (plans, mode) => {
        const now = new Date().toISOString();
        const withFreshIds: DataPlan[] = plans.map((p) => ({
          ...p,
          id: newId(),
          createdAt: now,
          updatedAt: now,
        }));

        if (mode === 'replace') {
          set({ plans: withFreshIds });
        } else {
          set((s) => ({ plans: [...s.plans, ...withFreshIds] }));
        }

        return { imported: withFreshIds.length };
      },
    }),
    {
      name: 'webazi-data-plan-store',
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

export function makeDefaultVariant(label: string): UssdVariant {
  return {
    id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label,
    ussd: '',
    startHour: 16,
    startMinute: 0,
    endHour: 23,
    endMinute: 0,
  };
}

export function emptyPlanDraft(): Omit<DataPlan, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    category: 'Data',
    name: '',
    enabled: true,
    pointsEnabled: false,
    sellingPrice: 0,
    safaricomPrice: 0,
    paymentMode: 'Till SIM',
    executeSim: 'SIM 1',
    notificationSim: 'SIM 1',
    ussdType: 'simple',
    autoRetry: true,
    retryCount: 2,
    retryOnPending: true,
    retryOnFailed: true,
    timeConfigured: false,
    ussd: '',
    ussdVariants: [],
  };
}
