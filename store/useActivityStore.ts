import { create } from 'zustand';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export type ActivityEntry = {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  // Optional — only present when the log is about a specific order
  // (SMS decoded, dial confirmed, delivery succeeded/failed, retry
  // scheduled). Lets the Home Activity list show a real trailing amount
  // instead of dropping the column.
  amount?: number;
  phone?: string;
};

type LogMeta = {
  amount?: number;
  phone?: string;
};

type State = {
  logs: ActivityEntry[];
  addLog: (level: LogLevel, message: string, meta?: LogMeta) => void;
  clear: () => void;
};

const MAX_LOGS = 200;

export const useActivityStore = create<State>((set) => ({
  logs: [],
  addLog: (level, message, meta) =>
    set((s) => ({
      logs: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          level,
          message,
          timestamp: Date.now(),
          amount: meta?.amount,
          phone: meta?.phone,
        },
        ...s.logs,
      ].slice(0, MAX_LOGS),
    })),
  clear: () => set({ logs: [] }),
}));
