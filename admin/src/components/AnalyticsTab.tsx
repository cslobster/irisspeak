import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../api';

interface SummaryRow {
  screen: string;
  element: string;
  event_type: string;
  event_count: number;
  unique_users: number;
  last_seen: string;
}

interface UserRow {
  dyad_id: string;
  alias: string;
  child_name: string;
  screen: string;
  element: string;
  event_type: string;
  event_count: number;
  last_seen: string;
}

const SCREEN_LABELS: Record<string, string> = {
  sign_in: 'Sign In',
  home: 'Home',
  free_topic: 'Free Topic',
  session: 'Session',
  session_end: 'Session End',
  stars: 'Stars',
};

const ELEMENT_LABELS: Record<string, string> = {
  login_button: 'Login button',
  topic_plan: "Topic: Today's plan",
  topic_recall: "Topic: Today's day",
  topic_free: 'Topic: Favorite',
  stars_button: 'Stars button',
  sign_out: 'Sign out',
  topic_select: 'Select topic',
  add_topic: 'Add topic',
  parent_message_send: 'Send parent message',
  card_tap: 'Tap card',
  card_confirm: 'Confirm cards',
  card_undo: 'Undo card',
  card_refresh: 'Refresh cards',
  card_search_open: 'Open card search',
  mic_start: 'Start mic',
  mic_stop: 'Stop mic',
  guide_example: 'Guide example',
  session_end: 'End session',
  session_abort: 'Abort session',
  dialogue_toggle: 'Toggle transcript',
  go_home: 'Go home',
  view_stars: 'View stars',
  session_expand: 'Expand session',
};

type View = 'summary' | 'by_user';

export function AnalyticsTab() {
  const [view, setView] = useState<View>('summary');
  const [summaryData, setSummaryData] = useState<SummaryRow[]>([]);
  const [userData, setUserData] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [screenFilter, setScreenFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [sum, byUser] = await Promise.all([
        adminApi.getAnalytics() as unknown as Promise<SummaryRow[]>,
        adminApi.getAnalyticsByUser() as unknown as Promise<UserRow[]>,
      ]);
      setSummaryData(sum);
      setUserData(byUser);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const screens = ['all', ...Array.from(new Set(summaryData.map(r => r.screen)))];
  const users = ['all', ...Array.from(new Set(userData.map(r => r.alias)))];

  const filteredSummary = screenFilter === 'all' ? summaryData : summaryData.filter(r => r.screen === screenFilter);
  const filteredUser = userData.filter(r =>
    (userFilter === 'all' || r.alias === userFilter) &&
    (screenFilter === 'all' || r.screen === screenFilter)
  );

  const totalEvents = filteredSummary.reduce((a, r) => a + r.event_count, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-xl font-extrabold text-slate-700">User Analytics</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={screenFilter}
            onChange={e => setScreenFilter(e.target.value)}
            className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 bg-white"
          >
            {screens.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'All screens' : SCREEN_LABELS[s] ?? s}</option>
            ))}
          </select>

          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {(['summary', 'by_user'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition ${
                  view === v ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {v === 'summary' ? 'By element' : 'By user'}
              </button>
            ))}
          </div>

          <button onClick={load} className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-600 transition">
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

      {!loading && (
        <div className="mb-5 flex gap-4">
          <div className="bg-indigo-50 border-2 border-indigo-100 rounded-2xl px-5 py-3">
            <div className="text-2xl font-extrabold text-indigo-700">{totalEvents.toLocaleString()}</div>
            <div className="text-xs font-bold uppercase tracking-widest text-indigo-500 mt-0.5">Total events</div>
          </div>
          <div className="bg-purple-50 border-2 border-purple-100 rounded-2xl px-5 py-3">
            <div className="text-2xl font-extrabold text-purple-700">{filteredSummary.length}</div>
            <div className="text-xs font-bold uppercase tracking-widest text-purple-500 mt-0.5">Unique interactions</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400 font-semibold">Loading…</div>
      ) : view === 'summary' ? (
        <SummaryTable rows={filteredSummary} />
      ) : (
        <UserTable
          rows={filteredUser}
          users={users}
          userFilter={userFilter}
          onUserFilter={setUserFilter}
        />
      )}
    </div>
  );
}

function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) return <p className="text-center py-16 text-slate-400 font-semibold">No events recorded yet.</p>;

  const grouped = rows.reduce<Record<string, SummaryRow[]>>((acc, r) => {
    (acc[r.screen] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([screen, rows]) => (
        <div key={screen} className="bg-white rounded-2xl shadow border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
            <span className="font-extrabold text-slate-700 text-sm">{SCREEN_LABELS[screen] ?? screen}</span>
            <span className="ml-2 text-xs text-slate-400 font-semibold">
              {rows.reduce((a, r) => a + r.event_count, 0).toLocaleString()} total events
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-50 text-xs font-bold text-slate-400 uppercase tracking-widest">
                <th className="px-5 py-3 text-left">Element</th>
                <th className="px-5 py-3 text-left">Event</th>
                <th className="px-5 py-3 text-center">Total taps</th>
                <th className="px-5 py-3 text-center">Unique users</th>
                <th className="px-5 py-3 text-left">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-semibold text-slate-700">{ELEMENT_LABELS[r.element] ?? r.element}</td>
                  <td className="px-5 py-3">
                    <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-lg font-semibold">{r.event_type}</span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <TapBar count={r.event_count} max={rows[0].event_count} />
                  </td>
                  <td className="px-5 py-3 text-center text-slate-500 font-bold">{r.unique_users}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs">{r.last_seen ? new Date(r.last_seen).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function TapBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 justify-center">
      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-extrabold text-indigo-700 w-8 text-right">{count}</span>
    </div>
  );
}

function UserTable({
  rows, users, userFilter, onUserFilter,
}: {
  rows: UserRow[]; users: string[]; userFilter: string; onUserFilter: (u: string) => void;
}) {
  if (rows.length === 0) return <p className="text-center py-16 text-slate-400 font-semibold">No events recorded yet.</p>;

  return (
    <div>
      <div className="mb-4">
        <select
          value={userFilter}
          onChange={e => onUserFilter(e.target.value)}
          className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 bg-white"
        >
          {users.map(u => <option key={u} value={u}>{u === 'all' ? 'All users' : u}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-widest">
              <th className="px-5 py-3.5 text-left">User</th>
              <th className="px-5 py-3.5 text-left">Screen</th>
              <th className="px-5 py-3.5 text-left">Element</th>
              <th className="px-5 py-3.5 text-center">Count</th>
              <th className="px-5 py-3.5 text-left">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                <td className="px-5 py-3 font-bold text-slate-700">{r.alias}</td>
                <td className="px-5 py-3 text-slate-500">{SCREEN_LABELS[r.screen] ?? r.screen}</td>
                <td className="px-5 py-3 text-slate-600">{ELEMENT_LABELS[r.element] ?? r.element}</td>
                <td className="px-5 py-3 text-center">
                  <span className="bg-indigo-100 text-indigo-700 text-xs font-extrabold px-2.5 py-0.5 rounded-full">{r.event_count}</span>
                </td>
                <td className="px-5 py-3 text-slate-400 text-xs">{r.last_seen ? new Date(r.last_seen).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
