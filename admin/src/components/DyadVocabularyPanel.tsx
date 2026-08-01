import { useState, useEffect } from 'react';
import { adminApi } from '../api';
import type { Dyad, CustomVocabularyWord } from '../types';

interface Props {
  dyad: Dyad;
}

// Read-only admin visibility into a dyad's Custom Vocabulary Word list and profile facts (see
// CONTEXT.md) — everything a parent has added via Settings → Vocabulary, the signup wizard's
// "interests" field, or (once built) AI-detected suggestions, all in one place for staff.
export function DyadVocabularyPanel({ dyad }: Props) {
  const [words, setWords] = useState<CustomVocabularyWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    adminApi.getDyadVocabulary(dyad.id)
      .then(setWords)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [dyad.id]);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-6 py-5 border-b border-slate-200 flex-shrink-0 bg-white">
        <h2 className="text-lg font-extrabold text-slate-800">{dyad.child_name}</h2>
        <p className="text-sm text-slate-500 font-semibold mt-0.5">{dyad.alias} · Profile &amp; vocabulary</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">Profile</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <ProfileField label="Age" value={dyad.age != null ? String(dyad.age) : null} />
            <ProfileField label="Status" value={dyad.status ?? 'active'} />
            <ProfileField label="Communication style" value={dyad.communication_style} />
            <ProfileField label="Parent email" value={dyad.parent_email} />
          </dl>
          {dyad.notes && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-1">Notes</div>
              <p className="text-sm text-slate-600 italic">"{dyad.notes}"</p>
            </div>
          )}
        </div>

        <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
          Custom Vocabulary Words ({words.length})
        </h3>

        {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

        {loading ? (
          <div className="text-center py-10 text-slate-400 font-semibold text-sm">Loading…</div>
        ) : words.length === 0 ? (
          <div className="text-center py-10 text-slate-400 font-semibold text-sm">No custom words added yet.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {words.map(w => (
              <div key={w.id} className="px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {w.image_data ? (
                    <img src={`data:image/png;base64,${w.image_data}`} alt="" className="w-8 h-8 rounded-lg object-cover" />
                  ) : (
                    <span className="text-xl w-8 text-center">{w.emoji || '❓'}</span>
                  )}
                  <div>
                    <div className="font-bold text-slate-700 text-sm">
                      {w.word}
                      {w.is_preference_pointer && (
                        <span className="ml-2 text-xs font-bold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">favorite</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">{w.category} · added by {w.source}</div>
                  </div>
                </div>
                <span className="text-xs text-slate-400">{new Date(w.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</dt>
      <dd className={`font-semibold ${value ? 'text-slate-700' : 'text-slate-300 italic'}`}>{value || 'Not set'}</dd>
    </div>
  );
}
