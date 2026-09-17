import { useEffect, useState } from 'react';
import { getProfile, setProfile } from '../engine/store';
import { pullProfile, pushProfile } from '../api/remote';

// Same fields as irisspeak.com's Profile screen: age, preferred way to communicate, and free notes. Loaded
// from and saved to the shared account; the local copy feeds the on-device model and reranker.
export function ProfileSettingsScreen() {
  const [gender, setGender] = useState<'boy' | 'girl'>('girl');
  const [age, setAge] = useState('');
  const [communicationStyle, setCommunicationStyle] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fill = () => { const p = getProfile(); setGender(p.gender === 'boy' ? 'boy' : 'girl'); setAge(p.age != null ? String(p.age) : ''); setCommunicationStyle(p.communication_style || ''); setNotes(p.notes || ''); };
    pullProfile().then(fill).catch(fill).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setSaved(false);
    const p = { ...getProfile(), gender, age: age ? Number(age) : null, communication_style: communicationStyle || null, notes: notes || null };
    setProfile(p);
    try { await pushProfile(p); setSaved(true); } finally { setSaving(false); }
  }

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: '#f0ebe1' }}>
      <div className="min-h-screen px-8 py-8 max-w-2xl mx-auto">
        <header className="mb-6">
          <h2 className="text-2xl font-extrabold text-black">Profile</h2>
        </header>
        {loading ? <p className="text-center text-slate-400 py-8">Loading…</p> : (
          <div className="rounded-2xl border-2 border-b-4 border-black bg-white p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Boy or girl</label>
              <div className="flex gap-2">
                {(['girl', 'boy'] as const).map(g => (
                  <button key={g} onClick={() => { setGender(g); setSaved(false); }} aria-pressed={gender === g} className={`flex-1 rounded-xl py-2 text-sm font-bold ${gender === g ? 'bg-[#94c1c2] text-white' : 'bg-slate-100 text-slate-600'}`}>{g === 'girl' ? '👧 Girl' : '👦 Boy'}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Age</label>
              <input type="number" value={age} onChange={e => setAge(e.target.value)} className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Preferred way to communicate</label>
              <input value={communicationStyle} onChange={e => setCommunicationStyle(e.target.value)} placeholder="e.g. mostly AAC, some verbal words" className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Anything else we should know?</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Interests, what helps them stay calm, sensory preferences…" rows={5} className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm" />
            </div>
            <button onClick={save} disabled={saving} className="w-full rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#94c1c2' }}>
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
