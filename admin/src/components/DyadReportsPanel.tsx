import { useState, useEffect } from 'react';
import { adminApi, type ReportDetail } from '../api';
import type { Dyad } from '../types';

interface Props {
  dyad: Dyad;
}

// One account's "Report a problem" submissions — screenshot, description, and whatever conversation
// context the app had on hand. Separate from board_feedback (card-choice feedback), which has no
// admin UI of its own yet.
export function DyadReportsPanel({ dyad }: Props) {
  const [reports, setReports] = useState<ReportDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  function load() {
    setLoading(true); setError('');
    adminApi.getDyadReports(dyad.id)
      .then(r => setReports(r.reports))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [dyad.id]);

  async function setStatus(id: string, status: 'open' | 'resolved') {
    await adminApi.setReportStatus(id, status);
    load();
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-6 py-5 border-b border-slate-200 flex-shrink-0 bg-white">
        <h2 className="text-lg font-extrabold text-slate-800">{dyad.child_name}</h2>
        <p className="text-sm text-slate-500 font-semibold mt-0.5">{dyad.alias} · Reports</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

        {loading ? (
          <div className="text-center py-10 text-slate-400 font-semibold text-sm">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="text-center py-10 text-slate-400 font-semibold text-sm">No reports from this account.</div>
        ) : (
          <div className="space-y-3">
            {reports.map(r => (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full ${r.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.status}</span>
                      <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-sm text-slate-700 mt-1 truncate">{r.description}</div>
                  </div>
                </button>
                {expanded === r.id && (
                  <div className="px-5 pb-5 border-t border-slate-100 pt-4">
                    {r.screenshot_data && <img src={r.screenshot_data} alt="Screenshot" className="w-full max-w-md rounded-xl border border-slate-200 mb-3" />}
                    <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-3 mb-3 whitespace-pre-wrap">{r.description}</p>
                    {r.context != null && (
                      <pre className="text-xs text-slate-600 bg-slate-50 rounded-xl p-3 mb-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(r.context, null, 2)}</pre>
                    )}
                    <div className="flex justify-end">
                      {r.status === 'open' ? (
                        <button onClick={() => setStatus(r.id, 'resolved')} className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition">Mark resolved</button>
                      ) : (
                        <button onClick={() => setStatus(r.id, 'open')} className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 transition">Reopen</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
