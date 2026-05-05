import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { authError, authStart, authSuccess, logout, useDispatch, useSelector } from '../store';
import { HillBackground } from '../components/HillBackground';
import { Logo } from '../components/Logo';

export function SignInScreen() {
  const [code, setCode] = useState('12345');
  const dispatch = useDispatch();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';
  const { isAuthorizing, error } = useSelector(s => s.auth);

  useEffect(() => {
    if (expired) {
      dispatch(logout());
    }
  }, [expired, dispatch]);

  async function submit() {
    if (!code.trim()) return;
    dispatch(authStart());
    try {
      const r = await api.login(code.trim());
      dispatch(authSuccess({ jwt: r.jwt, freeTopics: r.free_topics }));
      setSearchParams({});
      nav('/home', { replace: true });
    } catch (e: any) {
      dispatch(authError(e?.response?.status === 400 ? 'NoSuchUser' : 'Network'));
    }
  }

  return (
    <HillBackground>
      <div className="min-h-screen flex flex-col items-center justify-center pb-32">
        <Logo width={400} height={150} />
        {expired && (
          <p className="mt-4 text-base font-bold text-amber-600">
            Your previous session expired or the test data was reset. Please sign in again.
          </p>
        )}
        {isAuthorizing ? (
          <p className="mt-6 text-lg font-bold text-slate-500">Signing in…</p>
        ) : (
          <>
            {error && (
              <p className="mt-4 text-base font-bold text-red-400">
                {error === 'NoSuchUser' ? 'Code not recognized.' : 'Network error.'}
              </p>
            )}
            <input
              className="mt-6 text-2xl text-center bg-white rounded-2xl border-2 border-slate-300 focus:border-teal-500 focus:outline-none px-6 py-4 w-72 font-bold tracking-widest"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Insert number"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button
              className="pill-btn bg-[#f9aa33] mt-5 text-lg shadow-md"
              disabled={!code.trim()}
              onClick={submit}
            >
              Sign in
            </button>
            <p className="mt-8 text-xs text-slate-500">
              Test code: <span className="font-mono font-bold">12345</span>
            </p>
          </>
        )}
      </div>
    </HillBackground>
  );
}
