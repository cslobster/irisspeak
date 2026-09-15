import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { googleSignInUrl, signIn } from '../api/remote';
import { GoogleButton } from '../components/GoogleButton';
import { Spinner } from '../components/Spinner';

// Sign in with Google is the primary path (the API runs the OAuth flow and returns to #/google); the username +
// login code form stays available behind a link for accounts created by an admin.
export function SignInScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthorizing, setAuthorizing] = useState(false);
  const [showCode, setShowCode] = useState(false);   // the login-code form is behind a link; Google is the primary way in
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
              {/* Google is the primary way in; the login code stays for accounts made by the camp/admin. */}
              <GoogleButton href={googleSignInUrl()} />
              {!showCode ? (
                <button onClick={() => setShowCode(true)} className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition py-1">
                  Have a login code? Sign in with it →
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-3 text-xs font-bold text-slate-300 uppercase tracking-widest"><span className="flex-1 border-t-2 border-slate-100" />or<span className="flex-1 border-t-2 border-slate-100" /></div>
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
                  <button onClick={submit} disabled={!username.trim() || !password.trim()} className="pill-btn bg-[#94c1c2] w-full mt-1 disabled:opacity-40 text-base">Sign in →</button>
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
