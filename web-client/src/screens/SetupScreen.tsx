import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProfile, setProfile } from '../engine/store';
import { markSetupDone, pushProfile } from '../api/remote';

// First run after signing in: who is the child? Boy / girl (picks the voice), age, and an optional description that
// feeds the personal cards. Saved to the shared account; shown once (or until the account has an age).
export function SetupScreen() {
  const nav = useNavigate();
  const p = getProfile();
  const [name, setName] = useState(p.name || '');
  const [gender, setGender] = useState<'boy' | 'girl'>(p.gender === 'boy' ? 'boy' : 'girl');
  const [age, setAge] = useState(p.age != null ? String(p.age) : '');
  const [notes, setNotes] = useState(p.notes || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const next = { ...getProfile(), name: name.trim() || getProfile().name, gender, age: age ? Number(age) : null, notes: notes.trim() || null };
    setProfile(next); markSetupDone();
    try { await pushProfile(next); } catch {}
    nav('/home', { replace: true });
  }

  const tile = (on: boolean) => ({ background: on ? '#94c1c2' : '#fff', boxSizing: 'border-box' as const, border: '2px solid #000', borderBottomWidth: on ? 2 : 4, transform: on ? 'translateY(2px)' : undefined });
  return (
    <div className="relative min-h-screen overflow-hidden py-10 px-6" style={{ background: '#f0ebe1' }}>
      <div className="max-w-lg mx-auto">
        <h1 className="text-3xl font-extrabold text-center mb-1" style={{ color: '#94c1c2' }}>Tell us about your child</h1>
        <p className="text-center text-slate-600 font-semibold mb-6 text-sm">This picks the voice and helps the cards fit. You can change it later under Settings → Profile.</p>
        <div className="bg-white rounded-3xl p-7 flex flex-col gap-5" style={{ boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8 }}>
          <div>
            <label className={labelClass}>Child's name</label>
            <input className={inputClass} value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className={labelClass}>Boy or girl?</label>
            <div className="grid grid-cols-2 gap-3">
              {(['girl', 'boy'] as const).map(g => (
                <button key={g} onClick={() => setGender(g)} aria-pressed={gender === g} className="rounded-xl h-20 flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform" style={tile(gender === g)}>
                  <span className="text-3xl leading-none">{g === 'girl' ? '👧' : '👦'}</span>
                  <span className={`text-sm font-bold ${gender === g ? 'text-white' : 'text-slate-600'}`}>{g === 'girl' ? 'Girl' : 'Boy'}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Age</label>
            <input type="number" min={1} max={30} className={inputClass} value={age} onChange={e => setAge(e.target.value)} placeholder="e.g. 6" />
          </div>
          <div>
            <label className={labelClass}>Anything else we should know? <span className="normal-case tracking-normal text-slate-300">(optional)</span></label>
            <textarea rows={4} className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Interests, friends, pets, what helps them stay calm…" />
          </div>
          <button onClick={save} disabled={saving} className="pill-btn bg-[#94c1c2] w-full disabled:opacity-40 text-base">{saving ? 'Saving…' : 'Done →'}</button>
        </div>
      </div>
    </div>
  );
}
const labelClass = 'text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block';
const inputClass = 'w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base bg-slate-50 focus:outline-none focus:border-[#94c1c2] transition font-medium text-slate-800 placeholder-slate-300';
