import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Local app-wide tuning knobs, mirroring Bingwa's "USSD Settings" screen:
 * verified senders, dialog/screen behavior around dialing, timeouts,
 * auto-retry, auto-delete, and a privacy toggle for the Home stats.
 */

const DEFAULT_TRUSTED_SENDERS = ['MPESA'];

type State = {
  // Verified Senders — SMS on the Till SIM is only parsed if the sender
  // name matches one of these (case-insensitive, substring match).
  trustedSenders: string[];
  addTrustedSender: (sender: string) => void;
  removeTrustedSender: (sender: string) => void;

  // Auto-close ongoing USSD dialogs before starting a new one.
  autoCloseUssdDialogs: boolean;
  setAutoCloseUssdDialogs: (v: boolean) => void;

  // Keep the screen on for the duration of a (possibly multi-chunk) dial.
  keepScreenAwakeDuringDial: boolean;
  setKeepScreenAwakeDuringDial: (v: boolean) => void;

  // How long to wait for a USSD response before treating it as failed.
  // Kept for the legacy Sambaza flow and the manual test dial.
  ussdTimeoutMs: number;
  setUssdTimeoutMs: (ms: number) => void;

  // Data Plans Manager per-USSD-Type timing, mirroring the reference
  // USSD Settings screen. Simple & Normal plans share the shorter
  // timeout (Normal is stepped like Advanced, but expected to resolve
  // quickly and is held to stricter response classification — see
  // services/ussdResponseClassifier.ts — so it doesn't need Advanced's
  // longer budget). Advanced plans get the longer timeout since they
  // walk several menu screens with lenient (lockstep) classification.
  simpleUssdTimeoutMs: number;
  setSimpleUssdTimeoutMs: (ms: number) => void;
  advancedUssdTimeoutMs: number;
  setAdvancedUssdTimeoutMs: (ms: number) => void;

  // Delay between sending consecutive queued menu inputs during a
  // stepped (Normal/Advanced) dial — gives the carrier's USSD session a
  // moment before the next selection is typed.
  keyInputDelayMs: number;
  setKeyInputDelayMs: (ms: number) => void;

  // Login / Number Verification — the USSD code dialed on the
  // Notification SIM to read back "my own number" and confirm it
  // matches the account's Notification Number at login time. Safaricom
  // only — this app doesn't support Airtel notification lines.
  myNumberUssdSafaricom: string;
  setMyNumberUssdSafaricom: (v: string) => void;

  // Sambaza self top-up — "My Set number" is the default destination
  // for the agent's own airtime top-up form (Settings/Home → Sambaza
  // to self), so the agent doesn't have to retype their own number
  // every time.
  mySambazaNumber: string;
  setMySambazaNumber: (v: string) => void;

  // Customer-facing payment form -> Daraja STK Push backend (separate
  // Node/Express server, not this app). Base URL + the x-api-key header
  // that server's STK routes require. Defaults to the real deployed
  // backend; the API key ships blank since it's a secret only you have.
  darajaBackendUrl: string;
  setDarajaBackendUrl: (v: string) => void;
  darajaApiKey: string;
  setDarajaApiKey: (v: string) => void;

  autoSaveToContacts: boolean;
  setAutoSaveToContacts: (v: boolean) => void;
  contactsSaveDestination: 'app' | 'device';
  setContactsSaveDestination: (v: 'app' | 'device') => void;
  contactsKeywordSuffix: string;
  setContactsKeywordSuffix: (v: string) => void;
  contactsDuplicateHandling: 'skip' | 'update' | 'duplicate';
  setContactsDuplicateHandling: (v: 'skip' | 'update' | 'duplicate') => void;

  newClientWindowDays: number;
  setNewClientWindowDays: (v: number) => void;
  churnWindowDays: number;
  setChurnWindowDays: (v: number) => void;

  // Platform Exception Handling — what to do when USSD fails at the
  // platform layer (not a carrier response, an Android/telephony error).
  platformExceptionHandlingEnabled: boolean;
  setPlatformExceptionHandlingEnabled: (v: boolean) => void;
  platformExceptionAction: 'wait_then_proceed' | 'cancel_background';
  setPlatformExceptionAction: (v: 'wait_then_proceed' | 'cancel_background') => void;

  // Notifications — local alerts around USSD activity.
  failedTransactionAlertsEnabled: boolean;
  setFailedTransactionAlertsEnabled: (v: boolean) => void;
  ussdProcessingAlertsEnabled: boolean;
  setUssdProcessingAlertsEnabled: (v: boolean) => void;
  hapticFeedbackEnabled: boolean;
  setHapticFeedbackEnabled: (v: boolean) => void;

  // User Engagement — when a USSD response contains a trigger phrase,
  // send the customer a guiding SMS instead of leaving them stuck.
  engageIfAlreadyRecommended: boolean;
  setEngageIfAlreadyRecommended: (v: boolean) => void;
  engageOnTriggerText: boolean;
  setEngageOnTriggerText: (v: boolean) => void;
  engagementTriggerSubstring: string;
  setEngagementTriggerSubstring: (v: string) => void;
  engagementTriggerSms: string;
  setEngagementTriggerSms: (v: string) => void;

  // Auto-retry failed deliveries, with escalating backoff: attempt 2
  // fires after backoffMs[0], attempt 3 after backoffMs[1], etc. Once
  // attempts exceed the array length, the order is left failed with a
  // notification instead of retrying forever.
  autoRetryEnabled: boolean;
  setAutoRetryEnabled: (v: boolean) => void;
  autoRetryBackoffMs: number[];
  setAutoRetryBackoffMs: (ms: number[]) => void;

  // Purge completed/failed orders older than N days. null/0 = never.
  // Pending orders are never auto-deleted.
  autoDeleteDays: number | null;
  setAutoDeleteDays: (days: number | null) => void;
  autoDeleteLastRunAt: string | null;
  setAutoDeleteLastRunAt: (iso: string) => void;

  // Privacy toggle for the Home screen's queue stats.
  statsHidden: boolean;
  setStatsHidden: (v: boolean) => void;

  // Pause between consecutive USSD dials when a single order is chunked
  // into multiple *140*10000*...# dials (orders over KES 10,000). Without
  // this, back-to-back dials with zero gap can trip telco rate-limiting.
  interDialDelayMs: number;
  setInterDialDelayMs: (ms: number) => void;

  // Missed Messages — on app launch, scan the device's actual SMS inbox
  // for Till-SIM messages that arrived while the app/process was killed,
  // so a payment isn't silently lost.
  missedMessagesScanEnabled: boolean;
  setMissedMessagesScanEnabled: (v: boolean) => void;
  lastInboxScanAt: string | null;
  setLastInboxScanAt: (iso: string) => void;

  // Daily/weekly summary — shown automatically the next time the app is
  // opened after a day/week has passed since it was last shown (no
  // background task runner, so it can't be pushed while closed).
  dailySummaryEnabled: boolean;
  setDailySummaryEnabled: (v: boolean) => void;
  weeklySummaryEnabled: boolean;
  setWeeklySummaryEnabled: (v: boolean) => void;
  lastDailySummaryAt: string | null;
  setLastDailySummaryAt: (iso: string) => void;
  lastWeeklySummaryAt: string | null;
  setLastWeeklySummaryAt: (iso: string) => void;
};

export const useAppSettingsStore = create<State>()(
  persist(
    (set) => ({
      trustedSenders: DEFAULT_TRUSTED_SENDERS,
      addTrustedSender: (sender) => {
        const trimmed = sender.trim();
        if (!trimmed) return;
        set((s) =>
          s.trustedSenders.some((x) => x.toLowerCase() === trimmed.toLowerCase())
            ? s
            : { trustedSenders: [...s.trustedSenders, trimmed] }
        );
      },
      removeTrustedSender: (sender) => {
        set((s) => ({
          trustedSenders: s.trustedSenders.filter(
            (x) => x.toLowerCase() !== sender.toLowerCase()
          ),
        }));
      },

      autoCloseUssdDialogs: true,
      setAutoCloseUssdDialogs: (v) => set({ autoCloseUssdDialogs: v }),

      keepScreenAwakeDuringDial: false,
      setKeepScreenAwakeDuringDial: (v) => set({ keepScreenAwakeDuringDial: v }),

      ussdTimeoutMs: 30000,
      setUssdTimeoutMs: (ms) => set({ ussdTimeoutMs: Math.max(5000, ms) }),

      simpleUssdTimeoutMs: 60000,
      setSimpleUssdTimeoutMs: (ms) => set({ simpleUssdTimeoutMs: Math.max(5000, ms) }),
      advancedUssdTimeoutMs: 120000,
      setAdvancedUssdTimeoutMs: (ms) => set({ advancedUssdTimeoutMs: Math.max(5000, ms) }),
      keyInputDelayMs: 100,
      setKeyInputDelayMs: (ms) => set({ keyInputDelayMs: Math.max(1, Math.min(5000, ms)) }),

      myNumberUssdSafaricom: '*100*4*1*1#',
      setMyNumberUssdSafaricom: (v) => set({ myNumberUssdSafaricom: v }),
      mySambazaNumber: '',
      setMySambazaNumber: (v) => set({ mySambazaNumber: v }),

      darajaBackendUrl: 'https://webazi-digital-solutions.onrender.com',
      setDarajaBackendUrl: (v) => set({ darajaBackendUrl: v.trim().replace(/\/+$/, '') }),
      darajaApiKey: '',
      setDarajaApiKey: (v) => set({ darajaApiKey: v }),

      // Client -> Contacts Sync (Settings -> App Settings, mirrors the
      // reference app's "Client to Contacts Sync" section).
      autoSaveToContacts: false,
      setAutoSaveToContacts: (v) => set({ autoSaveToContacts: v }),
      contactsSaveDestination: 'app',
      setContactsSaveDestination: (v) => set({ contactsSaveDestination: v }),
      contactsKeywordSuffix: 'BG',
      setContactsKeywordSuffix: (v) => set({ contactsKeywordSuffix: v }),
      contactsDuplicateHandling: 'skip',
      setContactsDuplicateHandling: (v) => set({ contactsDuplicateHandling: v }),

      // Client Metrics thresholds (Client Metrics dashboard).
      newClientWindowDays: 7,
      setNewClientWindowDays: (v) => set({ newClientWindowDays: v }),
      churnWindowDays: 30,
      setChurnWindowDays: (v) => set({ churnWindowDays: v }),

      platformExceptionHandlingEnabled: true,
      setPlatformExceptionHandlingEnabled: (v) => set({ platformExceptionHandlingEnabled: v }),
      platformExceptionAction: 'wait_then_proceed',
      setPlatformExceptionAction: (v) => set({ platformExceptionAction: v }),

      failedTransactionAlertsEnabled: true,
      setFailedTransactionAlertsEnabled: (v) => set({ failedTransactionAlertsEnabled: v }),
      ussdProcessingAlertsEnabled: true,
      setUssdProcessingAlertsEnabled: (v) => set({ ussdProcessingAlertsEnabled: v }),
      hapticFeedbackEnabled: true,
      setHapticFeedbackEnabled: (v) => set({ hapticFeedbackEnabled: v }),

      engageIfAlreadyRecommended: false,
      setEngageIfAlreadyRecommended: (v) => set({ engageIfAlreadyRecommended: v }),
      engageOnTriggerText: false,
      setEngageOnTriggerText: (v) => set({ engageOnTriggerText: v }),
      engagementTriggerSubstring: 'engage',
      setEngagementTriggerSubstring: (v) => set({ engagementTriggerSubstring: v }),
      engagementTriggerSms: '',
      setEngagementTriggerSms: (v) => set({ engagementTriggerSms: v }),

      autoRetryEnabled: false,
      setAutoRetryEnabled: (v) => set({ autoRetryEnabled: v }),
      // 2min, 5min, 15min — 3 retries then leave it failed.
      autoRetryBackoffMs: [2 * 60000, 5 * 60000, 15 * 60000],
      setAutoRetryBackoffMs: (ms) =>
        set({ autoRetryBackoffMs: ms.filter((n) => Number.isFinite(n) && n > 0) }),

      autoDeleteDays: null,
      setAutoDeleteDays: (days) => set({ autoDeleteDays: days && days > 0 ? days : null }),
      autoDeleteLastRunAt: null,
      setAutoDeleteLastRunAt: (iso) => set({ autoDeleteLastRunAt: iso }),

      statsHidden: false,
      setStatsHidden: (v) => set({ statsHidden: v }),

      interDialDelayMs: 100,
      setInterDialDelayMs: (ms) =>
        set({ interDialDelayMs: Math.max(0, Math.min(10000, Math.round(ms))) }),

      missedMessagesScanEnabled: true,
      setMissedMessagesScanEnabled: (v) => set({ missedMessagesScanEnabled: v }),
      lastInboxScanAt: null,
      setLastInboxScanAt: (iso) => set({ lastInboxScanAt: iso }),

      dailySummaryEnabled: true,
      setDailySummaryEnabled: (v) => set({ dailySummaryEnabled: v }),
      weeklySummaryEnabled: true,
      setWeeklySummaryEnabled: (v) => set({ weeklySummaryEnabled: v }),
      lastDailySummaryAt: null,
      setLastDailySummaryAt: (iso) => set({ lastDailySummaryAt: iso }),
      lastWeeklySummaryAt: null,
      setLastWeeklySummaryAt: (iso) => set({ lastWeeklySummaryAt: iso }),
    }),
    {
      name: 'webazi-app-settings-store',

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
