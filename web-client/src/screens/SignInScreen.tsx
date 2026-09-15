import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { googleSignInUrl, requestEmailCode, signIn, signInWithEmailCode } from '../api/remote';
import { GoogleButton } from '../components/GoogleButton';
import { Spinner } from '../components/Spinner';

// Sign in with Google is the primary path (the API runs the OAuth flow and returns to #/google); the username +
// login code form stays available behind a link for accounts created by an admin.
export function SignInScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthorizing, setAuthorizing] = useState(false);
  // Three ways in: Google (primary), a code emailed to the parent, or the username + login code an admin issued.
  const [mode, setMode] = useState<'choose' | 'email' | 'password'>('choose');
  const [emailAddr, setEmailAddr] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [error, setError] = useState<'NoSuchUser' | 'Pending' | 'Network' | null>(null);
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';

  useEffect(() => { document.documentElement.classList.add('session-active'); return () => { document.documentElement.classList.remove('session-active'); }; }, []);

  async function doLogin(user: string, pass: string) {
    if (isAuthorizing) return;
    setAuthorizing(true); setError(null);
    try {
      await signIn(user, pass);
      setSearchParams({});
      nav('/home', { replace: true });
    } catch (e: any) {
      const m = String(e?.message || '');
      setError(m === 'NoSuchUser' ? 'NoSuchUser' : m === 'AccountPendingApproval' ? 'Pending' : 'Network');
    } finally { setAuthorizing(false); }
  }
  function submit() { if (!username.trim() || !password.trim()) return; doLogin(username.trim(), password.trim()); }

  async function sendCode() {
    if (!emailAddr.trim() || isAuthorizing) return;
    setAuthorizing(true); setError(null); setEmailNote(null);
    try {
      const r = await requestEmailCode(emailAddr);
      if (r.sent) { setEmailSent(true); setEmailNote('Check your email for a six-digit code. It expires in 10 minutes.'); }
      else if (r.reason === 'too_many') setEmailNote('Too many codes requested. Try again later, or sign in with Google.');
      else setEmailNote('Email sign-in is not switched on yet. Please sign in with Google, or use your login code.');
    } catch { setError('Network'); } finally { setAuthorizing(false); }
  }
  async function verifyCode() {
    if (!emailCode.trim() || isAuthorizing) return;
    setAuthorizing(true); setError(null);
    try { await signInWithEmailCode(emailAddr, emailCode); setSearchParams({}); nav('/home', { replace: true }); }
    catch (e: any) {
      const m = String(e?.message || '');
      setEmailNote(m === 'AccountPendingApproval' ? 'This account is waiting for approval.' : 'That code is wrong or has expired.');
    } finally { setAuthorizing(false); }
  }

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: '#f0ebe1' }}>
      <div className="relative z-10 flex flex-col items-center justify-center px-6" style={{ minHeight: '100vh' }}>
        <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-center mb-1 select-none" style={{ color: '#94c1c2' }}>Iris Speak</h1>
        <p className="text-slate-600 font-semibold mb-7 text-sm sm:text-base">Welcome! Sign in to continue.</p>

        <div className="bg-white rounded-3xl p-7 w-full max-w-sm" style={{ boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8 }}>
          {expired && <p className="mb-4 text-sm font-semibold text-[#f09281] bg-[#f09281]/10 rounded-xl px-3 py-2">Session expired — please sign in again.</p>}
          {error && (
            <p className="mb-4 text-sm font-semibold text-[#f09281] bg-[#f09281]/10 rounded-xl px-3 py-2">
              {error === 'NoSuchUser' ? 'Incorrect username or password.' : error === 'Pending' ? 'This account is waiting for approval.' : 'Network error — check your connection.'}
            </p>
          )}
          {isAuthorizing ? (
            <div className="flex items-center justify-center gap-3 py-6">
              <Spinner size={20} strokeWidth={6} />
              <p className="text-base font-semibold text-slate-500">Signing in…</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Google is the primary way in; an emailed code and the admin-issued login code are the alternatives. */}
              <GoogleButton href={googleSignInUrl()} />

              {mode === 'choose' && (
                <>
                  <div className="flex items-center gap-3 text-xs font-bold text-slate-300 uppercase tracking-widest"><span className="flex-1 border-t-2 border-slate-100" />or<span className="flex-1 border-t-2 border-slate-100" /></div>
                  <button onClick={() => setMode('email')} className="w-full rounded-xl px-3 py-3 text-[15px] font-bold text-slate-700 bg-white border-2 border-slate-200 hover:border-slate-400 transition whitespace-nowrap">
                    Sign in with an email code
                  </button>
                  <button onClick={() => setMode('password')} className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition py-1">
                    Sign in with a username and password →
                  </button>
                </>
              )}

              {mode === 'email' && (
                <>
                  <div className="flex items-center gap-3 text-xs font-bold text-slate-300 uppercase tracking-widest"><span className="flex-1 border-t-2 border-slate-100" />email code<span className="flex-1 border-t-2 border-slate-100" /></div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Your email</label>
                    <input className={inputClass} type="email" autoComplete="email" placeholder="you@example.com" autoFocus value={emailAddr}
                      onChange={e => { setEmailAddr(e.target.value); setEmailSent(false); }} onKeyDown={e => e.key === 'Enter' && sendCode()} />
                  </div>
                  {emailSent && (
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Six-digit code</label>
                      <input className={inputClass} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} value={emailCode}
                        onChange={e => setEmailCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && verifyCode()} />
                    </div>
                  )}
                  {emailNote && <p className="text-xs font-semibold text-slate-500">{emailNote}</p>}
                  {emailSent
                    ? <button onClick={verifyCode} disabled={emailCode.length < 6} className="pill-btn bg-[#94c1c2] w-full disabled:opacity-40 text-base">Sign in →</button>
                    : <button onClick={sendCode} disabled={!emailAddr.trim()} className="pill-btn bg-[#94c1c2] w-full disabled:opacity-40 text-base">Email me a code →</button>}
                  <button onClick={() => { setMode('choose'); setEmailSent(false); setEmailNote(null); }} className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition py-1">← Other ways to sign in</button>
                </>
              )}

              {mode === 'password' && (
                <>
                  <div className="flex items-center gap-3 text-xs font-bold text-slate-300 uppercase tracking-widest"><span className="flex-1 border-t-2 border-slate-100" />username<span className="flex-1 border-t-2 border-slate-100" /></div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Username</label>
                    <input className={inputClass} type="text" autoComplete="username" placeholder="Enter username" autoFocus value={username}
                      onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Password</label>
                    <input className={inputClass} type="password" autoComplete="current-password" placeholder="Enter password" value={password}
                      onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
                  </div>
                  <button onClick={submit} disabled={!username.trim() || !password.trim()} className="pill-btn bg-[#94c1c2] w-full disabled:opacity-40 text-base">Sign in →</button>
                  <button onClick={() => setMode('choose')} className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition py-1">← Other ways to sign in</button>
                </>
              )}
            </div>
          )}
        </div>

        <Link to="/signup" className="text-sm font-semibold text-slate-500 mt-5 hover:text-slate-700 transition">New here? Sign up →</Link>
      </div>
    </div>
  );
}

const inputClass = 'w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base bg-slate-50 focus:outline-none focus:border-[#94c1c2] transition font-medium text-slate-800 placeholder-slate-300';
