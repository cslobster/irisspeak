import { useState, useEffect, useCallback } from 'react';
import type { DyadStats } from '../types';
import { adminApi } from '../api';
import { DauChart } from './DauChart';

export function StatsTab() {
  const [stats, setStats] = useState<DyadStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setStats(await adminApi.getStats()); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = stats.reduce(
    (acc, s) => ({
      sessions: acc.sessions + s.session_count,
      turns: acc.turns + s.total_turns,
      messages: acc.messages + s.total_messages,
    }),
    { sessions: 0, turns: 0, messages: 0 }
  );

  return (
    <div>
      <div className="mb-6">
        <DauChart />
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-extrabold text-slate-700">Usage Stats</h2>
        <button onClick={load} className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-600 transition">
          Refresh
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

      {!loading && stats.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard label="Total Sessions" value={totals.sessions} color="indigo" />
          <StatCard label="Total Dialogue Turns" value={totals.turns} color="purple" />
          <StatCard label="Total Messages" value={totals.messages} color="emerald" />
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400 font-semibold">Loading…</div>
      ) : stats.length === 0 ? (
        <div className="text-center py-16 text-slate-400 font-semibold">No data yet.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-widest">
                <th className="px-5 py-3.5 text-left">User</th>
                <th className="px-5 py-3.5 text-left">Child</th>
                <th className="px-5 py-3.5 text-center">Sessions</th>
                <th className="px-5 py-3.5 text-center">Dialogue Turns</th>
                <th className="px-5 py-3.5 text-center">Messages</th>
                <th className="px-5 py-3.5 text-left">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.id} className={`border-b border-slate-50 hover:bg-slate-50/60 ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  <td className="px-5 py-4 font-bold text-slate-700">{s.alias}</td>
                  <td className="px-5 py-4 text-slate-600">{s.child_name}</td>
                  <td className="px-5 py-4 text-center">
                    <Pill value={s.session_count} color="indigo" />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Pill value={s.total_turns} color="purple" />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Pill value={s.total_messages} color="emerald" />
                  </td>
                  <td className="px-5 py-4 text-slate-400 text-xs">
                    {s.last_active ? new Date(s.last_active).toLocaleString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    purple: 'bg-purple-50 border-purple-100 text-purple-700',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
  };
  return (
    <div className={`rounded-2xl border-2 p-5 ${colors[color]}`}>
      <div className="text-3xl font-extrabold">{value}</div>
      <div className="text-xs font-bold uppercase tracking-widest mt-1 opacity-70">{label}</div>
    </div>
  );
}

function Pill({ value, color }: { value: number; color: string }) {
  if (value === 0) return <span className="text-slate-300 font-bold">—</span>;
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-100 text-indigo-700',
    purple: 'bg-purple-100 text-purple-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`inline-block px-3 py-0.5 rounded-full text-xs font-extrabold ${colors[color]}`}>
      {value}
    </span>
  );
}
