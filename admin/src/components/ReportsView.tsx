import { useState, useEffect, useCallback } from 'react';
import { adminApi, type ReportRow, type ReportDetail } from '../api';
import { ReportContextView } from './ReportContextView';
import { ImageLightbox } from './ImageLightbox';

// "Report a problem" — a parent's in-app screenshot + description of something wrong with the app
// itself, separate from board_feedback (the model's card-choice feedback, which has no admin UI).
type Filter = 'open' | 'resolved' | 'all';

export function ReportsView() {
  const [filter, setFilter] = useState<Filter>('open');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setReports(await adminApi.listReports(filter === 'all' ? undefined : filter)); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: 'open' | 'resolved') {
    await adminApi.setReportStatus(id, status);
    load();
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-extrabold text-slate-700">Reports</h2>
        <div className="flex items-center gap-2">
          {(['open', 'resolved', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl transition capitalize ${filter === f ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}>
              {f}
            </button>
          ))}
          <button onClick={load} className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-600 transition ml-2">Refresh</button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

      {loading ? (
        <div className="text-center py-16 text-slate-400 font-semibold">Loading…</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-slate-400 font-semibold">No {filter !== 'all' ? filter : ''} reports.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow border border-slate-200 divide-y divide-slate-100">
          {reports.map(r => (
            <button key={r.id} onClick={() => setOpenId(r.id)} className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700">{r.child_name || r.alias || 'Unknown'}</span>
                  <span className="text-xs text-slate-400">{r.parent_email || ''}</span>
                  {r.has_screenshot && <span className="text-xs" title="Has a screenshot">📷</span>}
                  <span className={`text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full ${r.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.status}</span>
                </div>
                <div className="text-sm text-slate-600 mt-1 truncate">{r.description}</div>
                <div className="text-xs text-slate-400 mt-0.5">{new Date(r.created_at).toLocaleString()}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {openId && <ReportDetailModal id={openId} onClose={() => setOpenId(null)} onStatus={setStatus} />}
    </div>
  );
}

function ReportDetailModal({ id, onClose, onStatus }: { id: string; onClose: () => void; onStatus: (id: string, status: 'open' | 'resolved') => Promise<void> }) {
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => { adminApi.getReport(id).then(setReport).catch(e => setError(e.message)); }, [id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-6" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!report ? (
          <div className="text-center py-10 text-slate-400 font-semibold">Loading…</div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-700">{report.child_name || report.alias}</h3>
                <p className="text-xs text-slate-400">{report.parent_email} · {new Date(report.created_at).toLocaleString()}</p>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            {report.screenshot_data && (
              <button onClick={() => setLightbox(true)} className="block w-full mb-4 cursor-zoom-in group relative" title="Click to view full size">
                <img src={report.screenshot_data} alt="Screenshot" className="w-full rounded-xl border border-slate-200" />
                <span className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/10 transition flex items-center justify-center">
                  <span className="opacity-0 group-hover:opacity-100 transition text-white text-xs font-bold bg-black/60 rounded-full px-3 py-1">Click to enlarge</span>
                </span>
              </button>
            )}
            <p className="text-sm font-bold text-slate-600 mb-1">What the parent said</p>
            <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-3 mb-4 whitespace-pre-wrap">{report.description}</p>
            {report.context != null && (
              <>
                <p className="text-sm font-bold text-slate-600 mb-1">Conversation</p>
                <div className="mb-4"><ReportContextView context={report.context} /></div>
              </>
            )}
            <div className="flex justify-end gap-2">
              {report.status === 'open' ? (
                <button onClick={() => onStatus(report.id, 'resolved').then(onClose)} className="text-sm font-bold px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition">Mark resolved</button>
              ) : (
                <button onClick={() => onStatus(report.id, 'open').then(onClose)} className="text-sm font-bold px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 transition">Reopen</button>
              )}
            </div>
          </>
        )}
      </div>
      {lightbox && report?.screenshot_data && <ImageLightbox src={report.screenshot_data} onClose={() => setLightbox(false)} />}
    </div>
  );
}
