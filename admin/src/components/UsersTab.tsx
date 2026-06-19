import { useState, useEffect, useCallback } from 'react';
import type { Dyad } from '../types';
import { adminApi } from '../api';
import { UserModal } from './UserModal';
import { TranscriptsDrawer } from './TranscriptsDrawer';

export function UsersTab() {
  const [dyads, setDyads] = useState<Dyad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'add' | Dyad | null>(null);
  const [transcriptsDyad, setTranscriptsDyad] = useState<Dyad | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setDyads(await adminApi.listDyads()); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(data: Partial<Dyad & { login_code: string }>) {
    if (modal === 'add') {
      await adminApi.createDyad(data as any);
    } else if (modal && typeof modal === 'object') {
      await adminApi.updateDyad(modal.id, data);
    }
    await load();
  }

  async function handleDelete(id: string, alias: string) {
    if (!confirm(`Delete user "${alias}"? This cannot be undone.`)) return;
    setDeleting(id);
    try { await adminApi.deleteDyad(id); await load(); }
    catch (e: any) { setError(e.message); }
    finally { setDeleting(null); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-extrabold text-slate-700">Users ({dyads.length})</h2>
        <button
          onClick={() => setModal('add')}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition shadow-sm"
        >
          + Add User
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

      {loading ? (
        <div className="text-center py-16 text-slate-400 font-semibold">Loading…</div>
      ) : dyads.length === 0 ? (
        <div className="text-center py-16 text-slate-400 font-semibold">No users yet.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-widest">
                <th className="px-5 py-3.5 text-left">Username</th>
                <th className="px-5 py-3.5 text-left">Child</th>
                <th className="px-5 py-3.5 text-left">Gender</th>
                <th className="px-5 py-3.5 text-left">Parent</th>
                <th className="px-5 py-3.5 text-left">Locale</th>
                <th className="px-5 py-3.5 text-left">Login Code</th>
                <th className="px-5 py-3.5 text-left">Created</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dyads.map((d, i) => (
                <tr key={d.id} className={`border-b border-slate-50 hover:bg-slate-50/60 ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  <td className="px-5 py-4 font-bold text-slate-700">{d.alias}</td>
                  <td className="px-5 py-4 text-slate-600">{d.child_name}</td>
                  <td className="px-5 py-4 capitalize text-slate-500">{d.child_gender}</td>
                  <td className="px-5 py-4 capitalize text-slate-500">{d.parent_type}</td>
                  <td className="px-5 py-4">
                    <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-0.5 rounded-lg uppercase">{d.locale}</span>
                  </td>
                  <td className="px-5 py-4">
                    <code className="bg-indigo-50 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-lg">{d.login_code ?? '—'}</code>
                  </td>
                  <td className="px-5 py-4 text-slate-400 text-xs">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setTranscriptsDyad(d)}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-purple-100 text-slate-600 hover:text-purple-700 transition"
                      >
                        Transcripts
                      </button>
                      <button
                        onClick={() => setModal(d)}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(d.id, d.alias)}
                        disabled={deleting === d.id}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 disabled:opacity-50 transition"
                      >
                        {deleting === d.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <UserModal
          dyad={modal === 'add' ? undefined : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {transcriptsDyad && (
        <TranscriptsDrawer
          dyad={transcriptsDyad}
          onClose={() => setTranscriptsDyad(null)}
        />
      )}
    </div>
  );
}
