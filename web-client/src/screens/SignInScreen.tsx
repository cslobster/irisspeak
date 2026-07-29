import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { analytics } from '../api/analytics';
import { authError, authStart, authSuccess, logout, useDispatch, useSelector } from '../store';
import { FlowerHillsBackdrop } from '../components/FlowerHills';

export function SignInScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const dispatch = useDispatch();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';
  const { isAuthorizing, error } = useSelector(s => s.auth);

  useEffect(() => {
    if (expired) dispatch(logout());
  }, [expired, dispatch]);

  async function submit() {
    if (!username.trim() || !password.trim() || isAuthorizing) return;
    analytics.signInAttempt();
    dispatch(authStart());
    try {
      const r = await api.login(username.trim(), password.trim());
      dispatch(authSuccess({ jwt: r.jwt, freeTopics: r.free_topics, childName: r.child_name }));
      analytics.signInSuccess();
      setSearchParams({});
      nav('/home', { replace: true });
    } catch (e: any) {
      dispatch(authError(e?.response?.status === 400 ? 'NoSuchUser' : 'Network'));
    }
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: '#f0ebe1' }}
    >
      {/* Decorative blobs */}
      <div className="absolute top-6 left-4 w-24 h-24 rounded-full bg-rose-300/30 blur-md pointer-events-none" />
      <div className="absolute top-10 right-8 w-32 h-32 rounded-full bg-amber-300/25 blur-md pointer-events-none" />
      <div className="absolute top-2 right-28 w-14 h-14 rounded-full bg-purple-300/30 blur-sm pointer-events-none" />
      <div className="absolute top-36 left-20 w-16 h-16 rounded-full bg-sky-300/25 blur-sm pointer-events-none" />
      <div className="absolute top-48 right-4 w-10 h-10 rounded-full bg-emerald-300/30 blur-sm pointer-events-none" />

      {/* Centered form — sits above the hills */}
      <div
        className="relative z-10 flex flex-col items-center justify-center px-6"
        style={{ minHeight: '60vh', paddingTop: '4vh' }}
      >
        {/* Title */}
        <h1
          className="text-5xl sm:text-7xl font-bold tracking-tight text-center mb-1 select-none"
          style={{
            background: 'linear-gradient(135deg, #f43f5e 0%, #a855f7 45%, #0ea5e9 80%, #10b981 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          AACessTalk
        </h1>
        <p className="text-slate-500 font-semibold mb-7 text-sm sm:text-base">
          Welcome! Sign in to continue.
        </p>

        {/* Form card */}
        <div className="bg-white/85 backdrop-blur-sm rounded-3xl shadow-xl border border-white/60 p-7 w-full max-w-sm">
          {expired && (
            <p className="mb-4 text-sm font-semibold text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              Session expired — please sign in again.
            </p>
          )}
          {error && (
            <p className="mb-4 text-sm font-semibold text-[#f09281] bg-[#f09281]/10 rounded-xl px-3 py-2">
              {error === 'NoSuchUser' ? 'Incorrect username or password.' : 'Network error — check your connection.'}
            </p>
          )}

          {isAuthorizing ? (
            <div className="flex items-center justify-center gap-3 py-6">
              <div className="w-5 h-5 border-2 border-purple-300 border-t-purple-500 rounded-full animate-spin motion-reduce:animate-none" />
              <p className="text-base font-semibold text-slate-500">Signing in…</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">
                  Username
                </label>
                <input
                  className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base bg-slate-50 focus:outline-none focus:border-purple-400 transition font-medium text-slate-800 placeholder-slate-300"
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
                  className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base bg-slate-50 focus:outline-none focus:border-purple-400 transition font-medium text-slate-800 placeholder-slate-300"
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
                className="pill-btn w-full mt-1 disabled:opacity-40 text-base"
                style={{ background: 'linear-gradient(135deg, #f43f5e 0%, #a855f7 100%)' }}
              >
                Sign in →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hills + flowers */}
      <FlowerHillsBackdrop />
    </div>
  );
}
