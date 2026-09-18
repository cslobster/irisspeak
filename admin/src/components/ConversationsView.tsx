import { useState, useEffect, useCallback } from 'react';
import type { Dyad } from '../types';
import { adminApi } from '../api';
import { UserModal } from './UserModal';
import { TranscriptPanel } from './TranscriptPanel';
import { DyadVocabularyPanel } from './DyadVocabularyPanel';

export function ConversationsView() {
  const [dyads, setDyads] = useState<Dyad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'add' | Dyad | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'conversations' | 'vocabulary'>('conversations');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const list = await adminApi.listDyads();
      setDyads(list);
      setSelectedId(prev => prev && list.some(d => d.id === prev) ? prev : (list[0]?.id ?? null));
    } catch (e: any) { setError(e.message); }
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

  async function handleDelete(e: React.MouseEvent, id: string, alias: string) {
    e.stopPropagation();
    if (!confirm(`Delete user "${alias}"? This cannot be undone.`)) return;
    setDeleting(id);
    try { await adminApi.deleteDyad(id); await load(); }
    catch (err: any) { setError(err.message); }
    finally { setDeleting(null); }
  }

  const selected = dyads.find(d => d.id === selectedId) ?? null;

  return (
    <div className="flex-1 flex min-h-0">
      {/* User list */}
      <div className="w-80 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-extrabold text-slate-700 uppercase tracking-widest">Users ({dyads.length})</h2>
          <button
            onClick={() => setModal('add')}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition"
          >
            + Add
          </button>
        </div>

        {error && <p className="mx-4 mt-3 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-10 text-slate-400 font-semibold text-sm">Loading…</div>
          ) : dyads.length === 0 ? (
            <div className="text-center py-10 text-slate-400 font-semibold text-sm px-4">No users yet. Add one to get started.</div>
          ) : (
            dyads.map(d => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`w-full text-left px-5 py-3.5 border-b border-slate-50 transition group ${
                  selectedId === d.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className={`font-bold text-sm truncate ${selectedId === d.id ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {d.child_name}
                    </div>
                    <div className="text-xs text-slate-400 truncate mt-0.5">
                      {d.alias}{d.login_code && <span className="font-mono text-slate-500"> · {d.login_code}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                    <span
                      role="button"
                      onClick={e => { e.stopPropagation(); setModal(d); }}
                      className="text-slate-400 hover:text-indigo-600 text-xs font-bold px-1.5"
                      title="Edit user"
                    >
                      ✎
                    </span>
                    <span
                      role="button"
                      onClick={e => handleDelete(e, d.id, d.alias)}
                      className="text-slate-400 hover:text-red-500 text-xs font-bold px-1.5"
                      title="Delete user"
                    >
                      {deleting === d.id ? '…' : '✕'}
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Selected user's conversations, or their profile + Custom Vocabulary Words
          (see CONTEXT.md's Profile Fact / Custom Vocabulary Word entries) */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="bg-white border-b border-slate-200 px-6 flex items-center gap-1 flex-shrink-0">
            {(['conversations', 'vocabulary'] as const).map(t => (
              <button
                key={t}
                onClick={() => setDetailTab(t)}
                className={`px-4 py-3 text-sm font-bold transition border-b-2 -mb-px ${
                  detailTab === t
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t === 'conversations' ? 'Conversations' : 'Profile & Vocabulary'}
              </button>
            ))}
          </div>
          {detailTab === 'conversations' ? (
            <TranscriptPanel key={selected.id} dyad={selected} />
          ) : (
            <DyadVocabularyPanel key={selected.id} dyad={selected} />
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 font-semibold text-sm">
          Select a user to view their conversations.
        </div>
      )}

      {modal && (
        <UserModal
          dyad={modal === 'add' ? undefined : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
