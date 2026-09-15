import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { CloseIcon } from '../components/Icons';

// Profile Fact context — age/notes/communication_style, always injected in full into the
// card-generation prompt (see CONTEXT.md's Profile Fact entry and prompts.ts's profileFacts
// param). These are the genuinely non-word-shaped facts; word-shaped facts (favorite things,
// names) belong on the Vocabulary settings screen instead.
export function ProfileSettingsScreen() {
  const nav = useNavigate();
  const [age, setAge] = useState('');
  const [communicationStyle, setCommunicationStyle] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getProfile().then((p) => {
      setAge(p.age != null ? String(p.age) : '');
      setCommunicationStyle(p.communication_style || '');
      setNotes(p.notes || '');
    }).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateProfile({
        age: age ? Number(age) : null,
        communication_style: communicationStyle || null,
        notes: notes || null,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: '#f0ebe1' }}>
      <div className="min-h-screen px-8 py-8 max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-extrabold text-black">Profile</h2>
          <button onClick={() => nav(-1)} className="rounded-xl p-2 bg-white border-2 border-b-4 border-black"><CloseIcon /></button>
        </header>

        {loading ? (
          <p className="text-center text-slate-400 py-8">Loading…</p>
        ) : (
          <div className="rounded-2xl border-2 border-b-4 border-black bg-white p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Age</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                Preferred way to communicate
              </label>
              <input
                value={communicationStyle}
                onChange={(e) => setCommunicationStyle(e.target.value)}
                placeholder="e.g. mostly AAC, some verbal words"
                className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                Anything else we should know?
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Interests, what helps them stay calm, sensory preferences…"
                rows={5}
                className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="w-full rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: '#94c1c2' }}
            >
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
