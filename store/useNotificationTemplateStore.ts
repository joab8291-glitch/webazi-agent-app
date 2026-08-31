import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Notification Templates store — the customer-facing SMS text sent when
 * a Data Plan order reaches a given outcome (matches Settings →
 * Notification Templates in the reference app).
 *
 * A template is keyed by (event, planId). `planId: null` means "Global"
 * — used for any plan that doesn't have its own override for that event.
 * At most one template exists per (event, planId) pair; saving again for
 * the same pair replaces it rather than creating a duplicate, same as
 * the reference screen's implied behavior.
 *
 * All events below are wired: `blacklisted` fires when a matched payment's
 * phone is in the Blacklisted Numbers list (see store/useBlacklistStore.ts),
 * `already_recommended` fires when the same phone+plan was already
 * delivered today (see store/useRecommendationTrackerStore.ts), and
 * `scheduled` fires when the USSD Scheduler successfully queues a
 * scheduled delivery (see services/scheduler.ts). The separate
 * `engageIfAlreadyRecommended` toggle in USSD Settings still references
 * a "Fallback Plans" concept that doesn't exist in this repo — that one
 * remains inert.
 */

export type NotificationEvent =
  | 'completed'
  | 'failed'
  | 'scheduled'
  | 'system_disabled'
  | 'unavailable_offer'
  | 'blacklisted'
  | 'already_recommended';

export const NOTIFICATION_EVENTS: NotificationEvent[] = [
  'completed',
  'failed',
  'scheduled',
  'system_disabled',
  'unavailable_offer',
  'blacklisted',
  'already_recommended',
];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  completed: 'Completed',
  failed: 'Failed',
  scheduled: 'Scheduled (Bingwa offer)',
  system_disabled: 'System/Plan Disabled',
  unavailable_offer: 'Unavailable Offer',
  blacklisted: 'Blacklisted',
  already_recommended: 'Already recommended',
};

/** All events are wired to fire today — see file header for where each
 * one is triggered. Kept as an explicit list (rather than just using
 * NOTIFICATION_EVENTS directly) so a future new event added to the type
 * without matching pipeline code shows up here as a visible gap. */
export const LIVE_NOTIFICATION_EVENTS: NotificationEvent[] = [
  'completed',
  'failed',
  'system_disabled',
  'unavailable_offer',
  'blacklisted',
  'already_recommended',
  'scheduled',
];

export const NOTIFICATION_PLACEHOLDERS = [
  'firstName',
  'lastName',
  'transactionId',
  'amount',
  'time',
  'date',
  'package',
  'phoneNumber',
  'pointsEarned',
  'totalPoints',
  'response',
  'reason',
  'status',
] as const;

export type NotificationTemplate = {
  id: string;
  event: NotificationEvent;
  planId: string | null;
  enabled: boolean;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type UpsertInput = {
  id?: string;
  event: NotificationEvent;
  planId: string | null;
  enabled: boolean;
  body: string;
};

type State = {
  templates: NotificationTemplate[];
  upsertTemplate: (input: UpsertInput) => string;
  deleteTemplate: (id: string) => void;
  setEnabled: (id: string, enabled: boolean) => void;
};

function newId() {
  return `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useNotificationTemplateStore = create<State>()(
  persist(
    (set, get) => ({
      templates: [],

      upsertTemplate: (input) => {
        const now = new Date().toISOString();

        if (input.id) {
          set((s) => ({
            templates: s.templates.map((t) =>
              t.id === input.id
                ? { ...t, event: input.event, planId: input.planId, enabled: input.enabled, body: input.body, updatedAt: now }
                : t
            ),
          }));
          return input.id;
        }

        const existing = get().templates.find((t) => t.event === input.event && t.planId === input.planId);
        if (existing) {
          set((s) => ({
            templates: s.templates.map((t) =>
              t.id === existing.id ? { ...t, enabled: input.enabled, body: input.body, updatedAt: now } : t
            ),
          }));
          return existing.id;
        }

        const id = newId();
        set((s) => ({
          templates: [
            ...s.templates,
            { id, event: input.event, planId: input.planId, enabled: input.enabled, body: input.body, createdAt: now, updatedAt: now },
          ],
        }));
        return id;
      },

      deleteTemplate: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

      setEnabled: (id, enabled) =>
        set((s) => ({
          templates: s.templates.map((t) => (t.id === id ? { ...t, enabled, updatedAt: new Date().toISOString() } : t)),
        })),
    }),
    {
      name: 'webazi-notification-template-store',
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
