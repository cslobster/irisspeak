import { useState, useEffect, useCallback } from 'react';
import type { Dyad } from '../types';
import { adminApi } from '../api';

// Self-serve signup wizard submissions land 'pending' until approved here (see
// CONTEXT.md's signup wizard design and docs/prd-personalization-core.md). Reuses
// listDyads() rather than a separate endpoint — same underlying data, filtered client-side.
export function PendingSignupsTab() {
  const [dyads, setDyads] = useState<Dyad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState<string | null>(null);
  const [approved, setApproved] = useState<Record<string, string>>({}); // id -> login_code

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setDyads(await adminApi.listDyads()); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(id: string) {
    setApproving(id);
    try {
      const r = await adminApi.approveDyad(id);
      setApproved((prev) => ({ ...prev, [id]: r.login_code }));
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApproving(null);
    }
  }

  const pending = dyads.filter((d) => d.status === 'pending');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-extrabold text-slate-700">Pending Signups</h2>
        <button onClick={load} className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-600 transition">
          Refresh
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

      {loading ? (
        <div className="text-center py-16 text-slate-400 font-semibold">Loading…</div>
      ) : pending.length === 0 ? (
        <div className="text-center py-16 text-slate-400 font-semibold">No pending signups.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow border border-slate-200 divide-y divide-slate-100">
          {pending.map((d) => (
            <div key={d.id} className="px-5 py-4 flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-700">{d.child_name} <span className="text-slate-400 font-semibold">· {d.child_gender}, {d.parent_type}</span></div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {d.age != null ? `age ${d.age} · ` : ''}
                  {d.communication_style ? `${d.communication_style} · ` : ''}
                  {d.parent_email || 'no email given'}
                </div>
                {d.notes && <div className="text-xs text-slate-500 mt-1 italic">"{d.notes}"</div>}
              </div>
              {approved[d.id] ? (
                <span className="text-xs font-extrabold text-emerald-700 bg-emerald-50 rounded-full px-3 py-1.5">
                  Approved — code {approved[d.id]}
                </span>
              ) : (
                <button
                  onClick={() => approve(d.id)}
                  disabled={approving === d.id}
                  className="text-xs font-bold px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition disabled:opacity-50"
                >
                  {approving === d.id ? 'Approving…' : 'Approve'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
