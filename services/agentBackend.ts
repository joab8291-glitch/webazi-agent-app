/**
 * Talks to the /agents routes added to the existing Daraja backend
 * (webazi-digital-solutions.onrender.com — see backend-addon/ folder
 * delivered alongside this app for the server-side code).
 *
 * This is what makes subscription state centrally controlled instead
 * of purely trusting AsyncStorage on the phone: on register/login and
 * on a periodic/foreground re-check, the app asks the server what the
 * true status is. See store/useSubscriptionStore.ts for how the
 * server response and the local offline-fallback computation are
 * reconciled.
 */
import { useAppSettingsStore } from '@/store/useAppSettingsStore';
import { sha256Hex } from './sha256';
import { getDeviceId } from './deviceId';

export type AgentRecord = {
  id: string;
  notificationNumber: string;
  buildVariant: 'agent' | 'free';
  isFreeAccess: boolean;
  revoked: boolean;
  firstLoginAt: string | null;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  lastPaidMonths: number | null;
  lastPaidAt: string | null;
  status: 'trial' | 'active' | 'expired' | 'revoked' | 'free';
  createdAt: string;
  updatedAt: string;
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; reason: string };

function baseUrl() {
  return useAppSettingsStore.getState().darajaBackendUrl;
}

/** Set at build time per app variant — see app.config.ts. 'agent' for
 * the paid Bingwa Agent app, 'free' for the Free-access clone. This is
 * only a *hint* stored server-side for the admin dashboard; it does
 * NOT itself bypass payment — actual gating always reads back
 * agent.status / agent.isFreeAccess from the server. */
export const BUILD_VARIANT: 'agent' | 'free' =
  (process.env.EXPO_PUBLIC_BUILD_VARIANT as 'agent' | 'free') || 'agent';

async function post<T>(path: string, body: any, extraHeaders?: Record<string, string>): Promise<Ok<T> | Err> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, reason: data.reason || `Server error (${res.status})` };
    }
    return { ok: true, ...data };
  } catch (e: any) {
    return { ok: false, reason: e?.message === 'Network request failed' ? 'offline' : String(e?.message ?? e) };
  }
}

async function get<T>(path: string, extraHeaders?: Record<string, string>): Promise<Ok<T> | Err> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, { headers: extraHeaders });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, reason: data.reason || `Server error (${res.status})` };
    }
    return { ok: true, ...data };
  } catch (e: any) {
    return { ok: false, reason: e?.message === 'Network request failed' ? 'offline' : String(e?.message ?? e) };
  }
}

export async function registerAgentOnBackend(notificationNumber: string, password: string) {
  const deviceId = await getDeviceId();
  return post<{ agentId: string; agentKey: string; agent: AgentRecord }>('/agents/register', {
    notificationNumber,
    passwordHashClient: sha256Hex(password),
    deviceId,
    buildVariant: BUILD_VARIANT,
  });
}

export async function loginAgentOnBackend(notificationNumber: string, password: string) {
  const deviceId = await getDeviceId();
  return post<{ agentId: string; agentKey: string; agent: AgentRecord }>('/agents/login', {
    notificationNumber,
    passwordHashClient: sha256Hex(password),
    deviceId,
  });
}

export async function fetchAgentStatus(agentId: string, agentKey: string) {
  return get<{ agent: AgentRecord }>(`/agents/${agentId}/status`, { 'x-agent-key': agentKey });
}

export async function reportPayment(
  agentId: string,
  agentKey: string,
  months: 1 | 2,
  method: 'stk' | 'sambaza',
  reference?: string
) {
  return post<{ agent: AgentRecord }>(
    `/agents/${agentId}/payment`,
    { months, method, reference },
    { 'x-agent-key': agentKey }
  );
}
