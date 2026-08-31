/**
 * Client for the separate Daraja STK Push backend
 * (https://webazi-digital-solutions.onrender.com — Node/Express, source
 * in mpesa-daraja-server), used by the customer-facing payment form.
 *
 * Matches the real backend's routes/stkPush.js exactly:
 *   POST {base}/mpesa/stk-push   { phone, amount, accountRef, description }
 *   GET  {base}/mpesa/order-status?merchantRequestId=...
 * Both require header  x-api-key: <darajaApiKey>  (server fails closed
 * if its own API_KEY env isn't set, and rejects any request whose
 * x-api-key doesn't match).
 */

import { useAppSettingsStore } from '@/store/useAppSettingsStore';

export type OrderStatus = {
  merchantRequestId: string;
  checkoutRequestId: string;
  phone: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  timestamp: string;
  receipt: string | null;
  completedAt: string | null;
  error?: string;
};

export type StkPushResult =
  | { ok: true; merchantRequestId: string; checkoutRequestId: string }
  | { ok: false; reason: string };

function backendConfig() {
  const { darajaBackendUrl, darajaApiKey } = useAppSettingsStore.getState();
  return { baseUrl: darajaBackendUrl, apiKey: darajaApiKey };
}

/**
 * Kick off an STK push. `accountRef` is what shows as the M-Pesa
 * account reference on the customer's statement — this is where the
 * agent's own notification/receiving number goes, per the spec, so the
 * agent can tell which of their numbers a given payment belongs to.
 */
export async function initiateStkPush(input: {
  phone: string;
  amount: number;
  accountRef: string;
  description?: string;
}): Promise<StkPushResult> {
  const { baseUrl, apiKey } = backendConfig();

  if (!baseUrl) return { ok: false, reason: 'Daraja backend URL is not configured (Settings)' };
  if (!apiKey) return { ok: false, reason: 'Daraja API key is not configured (Settings)' };

  try {
    const res = await fetch(`${baseUrl}/mpesa/stk-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        phone: input.phone,
        amount: input.amount,
        accountRef: input.accountRef,
        description: input.description ?? 'Bingwa Sokoni payment',
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return { ok: false, reason: data?.error ?? `Backend returned ${res.status}` };
    }
    if (!data?.MerchantRequestID || !data?.CheckoutRequestID) {
      return { ok: false, reason: 'Backend accepted the request but returned no request IDs' };
    }

    return {
      ok: true,
      merchantRequestId: data.MerchantRequestID,
      checkoutRequestId: data.CheckoutRequestID,
    };
  } catch (e: any) {
    return { ok: false, reason: `Could not reach backend: ${String(e?.message ?? e)}` };
  }
}

async function fetchOrderStatus(merchantRequestId: string): Promise<OrderStatus | null> {
  const { baseUrl, apiKey } = backendConfig();
  if (!baseUrl || !apiKey) return null;

  try {
    const res = await fetch(
      `${baseUrl}/mpesa/order-status?merchantRequestId=${encodeURIComponent(merchantRequestId)}`,
      { headers: { 'x-api-key': apiKey } }
    );
    if (!res.ok) return null;
    return (await res.json()) as OrderStatus;
  } catch {
    return null;
  }
}

/**
 * Poll order-status until it settles to completed/failed, or time out.
 * The customer enters their M-Pesa PIN on their own phone in response
 * to the STK prompt — this just watches for the backend's callback to
 * update the order.
 */
export function pollOrderStatus(
  merchantRequestId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<{ ok: true; order: OrderStatus } | { ok: false; reason: string; order?: OrderStatus }> {
  const intervalMs = opts.intervalMs ?? 4000;
  const timeoutMs = opts.timeoutMs ?? 2 * 60 * 1000;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const tick = async () => {
      const order = await fetchOrderStatus(merchantRequestId);

      if (order?.status === 'completed') {
        resolve({ ok: true, order });
        return;
      }
      if (order?.status === 'failed') {
        resolve({ ok: false, reason: order.error ?? 'Payment failed or was cancelled', order });
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve({ ok: false, reason: 'Timed out waiting for payment confirmation', order: order ?? undefined });
        return;
      }
      setTimeout(tick, intervalMs);
    };

    tick();
  });
}
