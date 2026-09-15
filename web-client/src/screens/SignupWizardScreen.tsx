import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { signUp } from '../api/remote';

// Same sign-up as irisspeak.com. Submissions land in a 'pending' status until an admin approves them;
// this screen never issues a working login on its own.
export function SignupWizardScreen() {
  const [childName, setChildName] = useState('');
  const [age, setAge] = useState('');
  const [childGender, setChildGender] = useState<'boy' | 'girl'>('girl');
  const [loginCode, setLoginCode] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [interests, setInterests] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedAlias, setSubmittedAlias] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.documentElement.classList.add('session-active'); return () => { document.documentElement.classList.remove('session-active'); }; }, []);

  async function submit() {
    if (!childName.trim() || !loginCode.trim() || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const r = await signUp({
        child_name: childName.trim(), child_gender: childGender, login_code: loginCode.trim(),
        age: age ? Number(age) : undefined, notes: notes.trim() || undefined, parent_email: parentEmail.trim() || undefined,
        interests: interests.split(',').map(s => s.trim()).filter(Boolean),
      });
      setSubmittedAlias(r.alias);
    } catch { setError('Something went wrong submitting your signup. Please try again.'); }
    finally { setSubmitting(false); }
  }

  if (submittedAlias) {
    return (
      <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-6" style={{ background: '#f0ebe1' }}>
        <div className="bg-white rounded-3xl p-8 w-full max-w-sm text-center" style={{ boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8 }}>
          <h2 className="text-2xl font-extrabold text-slate-800 mb-3">Thanks!</h2>
          <p className="text-sm text-slate-600 mb-4">Your signup is waiting for approval. Once it's approved, sign in with:</p>
          <div className="bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 mb-6 text-left">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Username</p>
            <p className="font-mono font-bold text-slate-800 mb-2">{submittedAlias}</p>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Login code</p>
            <p className="font-mono font-bold text-slate-800">{loginCode}</p>
          </div>
          <Link to="/" className="pill-btn bg-[#94c1c2] inline-block">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden py-10 px-6" style={{ background: '#f0ebe1' }}>
      <div className="max-w-lg mx-auto">
        <h1 className="text-3xl font-extrabold text-center mb-1" style={{ color: '#94c1c2' }}>Sign up</h1>
        <p className="text-center text-slate-600 font-semibold mb-6 text-sm">Tell us about your child — accounts need approval before they're active.</p>
        <div className="bg-white rounded-3xl p-7" style={{ boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8 }}>
          {error && <p className="mb-4 text-sm font-semibold text-[#f09281] bg-[#f09281]/10 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex flex-col gap-4">
            <Field label="Child's name"><input className={inputClass} value={childName} onChange={e => setChildName(e.target.value)} autoFocus /></Field>
            <div className="flex gap-3">
              <Field label="Age"><input type="number" className={inputClass} value={age} onChange={e => setAge(e.target.value)} /></Field>
              <Field label="Gender">
                <select className={inputClass} value={childGender} onChange={e => setChildGender(e.target.value as 'boy' | 'girl')}>
                  <option value="girl">Girl</option><option value="boy">Boy</option>
                </select>
              </Field>
            </div>
            <Field label="Your email"><input type="email" className={inputClass} value={parentEmail} onChange={e => setParentEmail(e.target.value)} /></Field>
            <Field label="Choose a login code (you'll use this to sign in once approved)">
              <input className={inputClass} placeholder="e.g. 12345" value={loginCode} onChange={e => setLoginCode(e.target.value)} />
            </Field>
            <Field label="Interests (comma separated)">
              <input className={inputClass} placeholder="e.g. dinosaurs, Bluey, Legos" value={interests} onChange={e => setInterests(e.target.value)} />
            </Field>
            <Field label="Anything else we should know?">
              <textarea className={inputClass} rows={4} placeholder="Sensory preferences, what helps them stay calm…" value={notes} onChange={e => setNotes(e.target.value)} />
            </Field>
            <button onClick={submit} disabled={!childName.trim() || !loginCode.trim() || submitting} className="pill-btn bg-[#94c1c2] w-full mt-1 disabled:opacity-40 text-base">
              {submitting ? 'Submitting…' : 'Submit for approval →'}
            </button>
          </div>
        </div>
        <Link to="/" className="block text-center text-sm font-semibold text-slate-500 mt-5 hover:text-slate-700 transition">Already have an account? Sign in</Link>
      </div>
    </div>
  );
}

const inputClass = 'w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base bg-slate-50 focus:outline-none focus:border-[#94c1c2] transition font-medium text-slate-800 placeholder-slate-300';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="flex-1"><label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">{label}</label>{children}</div>);
}
