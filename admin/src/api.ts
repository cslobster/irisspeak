import type { Dyad, DyadStats, UserEventStat } from './types';

const BASE = '/api/v1/admin';
const TOKEN_KEY = 'aac_admin_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function saveToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
export function hasToken() {
  return !!localStorage.getItem(TOKEN_KEY);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

export const adminApi = {
  login: (password: string) =>
    fetch('/api/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then(async (r) => {
      if (!r.ok) throw new Error('Invalid password');
      return r.json() as Promise<{ token: string }>;
    }),

  listDyads: () => req<Dyad[]>('GET', '/dyads'),
  createDyad: (data: Omit<Dyad, 'id' | 'created_at'> & { login_code: string }) =>
    req<Dyad>('POST', '/dyads', data),
  updateDyad: (id: string, data: Partial<Dyad & { login_code: string }>) =>
    req<Dyad>('PATCH', `/dyads/${id}`, data),
  deleteDyad: (id: string) => req<{ deleted: string }>('DELETE', `/dyads/${id}`),

  getStats: () => req<DyadStats[]>('GET', '/stats'),

  getAnalytics: () => req<UserEventStat[]>('GET', '/analytics?view=summary'),
  getAnalyticsByUser: () => req<UserEventStat[]>('GET', '/analytics?view=by_user'),

  getTranscripts: (dyadId: string) =>
    req<{ sessions: SessionRow[]; messages: MessageRow[] }>('GET', `/dyads/${dyadId}/transcripts`),
};

export interface SessionRow {
  id: string;
  topic_category: string;
  subtopic: string | null;
  status: string;
  num_turns: number;
  started_timestamp: number | null;
  ended_timestamp: number | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: 'parent' | 'child';
  content_type: 'text' | 'cards';
  content: unknown;
  timestamp: number;
  inferred_sentence: string | null;
}
