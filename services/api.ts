const BASE_URL = 'https://webazi-digital-solutions.onrender.com';

export type Transaction = {
  id: number;
  receipt: string;
  phone: string;
  amount: number;
  delivered_amount: number;
  status: 'pending' | 'completed' | 'failed' | 'retry';
  attempts: number;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }

  // Some endpoints return empty body
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }
  return res.json();
}

export async function fetchAll(status?: string): Promise<Transaction[]> {
  const url = status ? `/transactions?status=${encodeURIComponent(status)}` : '/transactions';
  return request<Transaction[]>(url);
}

export async function reportComplete(id: number): Promise<void> {
  await request(`/transactions/${id}/complete`, { method: 'POST' });
}

export async function reportFail(id: number, reason: string): Promise<void> {
  await request(`/transactions/${id}/fail`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function requeue(id: number): Promise<void> {
  await request(`/transactions/${id}/requeue`, { method: 'POST' });
}
export async function healthCheck(): Promise<{ status: string; timestamp?: string }> {
  return request('/health');
}
