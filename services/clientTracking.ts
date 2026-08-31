import { useClientStore } from '@/store/useClientStore';
import { syncClientToContacts } from './contactsSync';

/**
 * Single hook point for "a payment just completed" — called from
 * useTransactionStore's markCompleted(). Feeds the Client Metrics
 * dashboard and (if enabled) Client -> Contacts Sync. Kept as its own
 * module so useTransactionStore doesn't need to import two different
 * feature stores/services directly.
 */
export function recordCompletedPayment(input: { phone: string; amount: number; name?: string | null }) {
  const client = useClientStore.getState().recordPurchase(input);
  if (!client) return;

  // Fire and forget — contacts sync failures shouldn't affect the
  // transaction/delivery flow that triggered this in any way.
  syncClientToContacts(client).catch(() => {});
}
