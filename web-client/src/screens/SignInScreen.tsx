import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { analytics } from '../api/analytics';
import { authError, authStart, authSuccess, logout, useDispatch, useSelector } from '../store';
import { Spinner } from '../components/Spinner';
import { GoogleButton } from '../components/GoogleButton';

export function SignInScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const dispatch = useDispatch();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';
  const { isAuthorizing, error } = useSelector(s => s.auth);

  const googleError = searchParams.get('error');
  useEffect(() => {
    if (expired) dispatch(logout());
    if (googleError) dispatch(authError(googleError === 'AccountPendingApproval' ? 'Pending' : 'Google'));
  }, [expired, googleError, dispatch]);

  async function doLogin(user: string, pass: string) {
    if (isAuthorizing) return;
    analytics.signInAttempt();
    dispatch(authStart());
    try {
      const r = await api.login(user, pass);
      dispatch(authSuccess({ jwt: r.jwt, freeTopics: r.free_topics, childName: r.child_name }));
      analytics.signInSuccess();
      setSearchParams({});
      nav('/home', { replace: true });
    } catch (e: any) {
      dispatch(authError(e?.response?.status === 400 ? 'NoSuchUser' : 'Network'));
    }
  }

  function submit() {
    if (!username.trim() || !password.trim()) return;
    doLogin(username.trim(), password.trim());
  }

  // Guest/demo account (seeded in db.ts alongside the primary test dyad) — a one-tap way for
  // anyone trying the app (reviewers, curious parents) to see it working without needing a
  // real invite/signup.
  function continueAsGuest() {
    doLogin('guest', '12345');
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: '#f0ebe1' }}
    >
      <div
        className="relative z-10 flex flex-col items-center justify-center px-6"
        style={{ minHeight: '100vh' }}
      >
        {/* Title */}
        <h1
          className="text-5xl sm:text-7xl font-bold tracking-tight text-center mb-1 select-none"
          style={{ color: '#94c1c2' }}
        >
          Iris Speak
        </h1>
        <p className="text-slate-600 font-semibold mb-7 text-sm sm:text-base">
          Welcome! Sign in to continue.
        </p>

        {/* Form card */}
        <div
          className="bg-white rounded-3xl p-7 w-full max-w-sm"
          style={{ boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8 }}
        >
          {expired && (
            <p className="mb-4 text-sm font-semibold text-[#f09281] bg-[#f09281]/10 rounded-xl px-3 py-2">
              Session expired — please sign in again.
            </p>
          )}
          {error && (
            <p className="mb-4 text-sm font-semibold text-[#f09281] bg-[#f09281]/10 rounded-xl px-3 py-2">
              {error === 'NoSuchUser' ? 'Incorrect username or password.' : error === 'Pending' ? 'This account is waiting for approval.' : error === 'Google' ? 'Google sign-in failed — please try again.' : 'Network error — check your connection.'}
            </p>
          )}

          {isAuthorizing ? (
            <div className="flex items-center justify-center gap-3 py-6">
              <Spinner size={20} strokeWidth={6} />
              <p className="text-base font-semibold text-slate-500">Signing in…</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">
                  Username
                </label>
                <input
                  className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base bg-slate-50 focus:outline-none focus:border-[#94c1c2] transition font-medium text-slate-800 placeholder-slate-300"
                  type="text"
                  autoComplete="username"
                  placeholder="Enter username"
                  autoFocus
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">
                  Password
                </label>
                <input
                  className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base bg-slate-50 focus:outline-none focus:border-[#94c1c2] transition font-medium text-slate-800 placeholder-slate-300"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                />
              </div>
              <button
                onClick={submit}
                disabled={!username.trim() || !password.trim()}
                className="pill-btn bg-[#94c1c2] w-full mt-1 disabled:opacity-40 text-base"
              >
                Sign in →
              </button>
              <div className="flex items-center gap-3 text-xs font-bold text-slate-300 uppercase tracking-widest">
                <span className="flex-1 border-t-2 border-slate-100" />or<span className="flex-1 border-t-2 border-slate-100" />
              </div>
              <GoogleButton href={api.googleSignInUrl()} />
            </div>
          )}
        </div>

        <Link to="/signup" className="text-sm font-semibold text-slate-500 mt-5 hover:text-slate-700 transition">
          New here? Sign up →
        </Link>
        <button
          onClick={continueAsGuest}
          disabled={isAuthorizing}
          className="text-sm font-semibold text-slate-400 mt-2 hover:text-slate-600 transition disabled:opacity-40"
        >
          Just want to try it? Continue as Guest →
        </button>
      </div>
    </div>
  );
}
