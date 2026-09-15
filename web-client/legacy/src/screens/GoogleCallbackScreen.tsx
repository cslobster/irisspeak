import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { analytics } from '../api/analytics';
import { authSuccess, useDispatch } from '../store';
import { Spinner } from '../components/Spinner';

// /google#jwt=…&alias=…&child_name=…[&new=1]  or  /google#error=…  — where the API sends the browser
// back after Google sign-in. The token rides in the fragment so it never hits a server log. New accounts
// land on the Profile screen first so the parent can set the child's name.
export function GoogleCallbackScreen() {
  const nav = useNavigate();
  const dispatch = useDispatch();
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const jwt = p.get('jwt');
    if (!jwt) { nav(`/?error=${encodeURIComponent(p.get('error') || 'google_failed')}`, { replace: true }); return; }
    window.history.replaceState(null, '', '/google');
    api.loginWithToken(jwt)
      .then(r => { dispatch(authSuccess({ jwt: r.jwt, freeTopics: r.free_topics, childName: r.child_name })); analytics.signInSuccess(); nav(p.get('new') === '1' ? '/profile' : '/home', { replace: true }); })
      .catch(() => { api.setJwt(null); nav('/?error=google_failed', { replace: true }); });
  }, []);
  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-6" style={{ background: '#f0ebe1' }}>
      <div className="flex items-center justify-center gap-3 py-4"><Spinner size={20} strokeWidth={6} /><p className="text-base font-semibold text-slate-500">Signing in with Google…</p></div>
    </div>
  );
}
